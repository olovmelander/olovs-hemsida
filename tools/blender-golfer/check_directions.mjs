import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, serviceWorkers: 'block' });
const report = { movement: [], turns: [], aim: [], course: [], errors: [] };
page.on('pageerror', e => report.errors.push(e.message));
try {
  await page.goto('http://127.0.0.1:5180/golfer-study.html');
  await page.waitForFunction(() => window.GOLFER_STUDY, undefined, { timeout: 60000 });
  for (const view of ['front', 'side', 'back']) for (const key of ['w', 'a', 's', 'd']) {
    await page.evaluate(view => {
      const { golfer:g, camera, controls } = GOLFER_STUDY;
      g.paused=false;g.rate=1;g.root.position.set(0,0,0);g.root.rotation.y=0;g.play('Idle',{fade:0});
      controls.enableDamping=false;controls.target.set(0,1.02,0);
      camera.position.set(...{front:[0,1.3,5],side:[5,1.3,0],back:[0,1.3,-5]}[view]);controls.update();
      document.activeElement?.blur();
    },view);
    await page.keyboard.down(key);
    try { await page.waitForFunction(() => GOLFER_STUDY.golfer.root.position.length()>.13, undefined, { timeout:15000 }); }
    finally { await page.keyboard.up(key); }
    const state=await page.evaluate(async ({view,key}) => {
      const THREE=await import('/node_modules/three/build/three.webgpu.js');
      const {golfer:g,camera}=GOLFER_STUDY;
      const forward=camera.getWorldDirection(new THREE.Vector3());forward.y=0;forward.normalize();
      const right=forward.clone().cross(new THREE.Vector3(0,1,0));
      const expected=key==='w'?forward:key==='s'?forward.negate():key==='d'?right:right.negate();
      const actual=g.root.position.clone().setY(0).normalize();
      const facing=new THREE.Vector3(0,0,1).applyQuaternion(g.root.quaternion);
      return {view,key,travelAlignment:actual.dot(expected),facingAlignment:facing.dot(actual)};
    },{view,key});
    assert(state.travelAlignment>.999 && state.facingAlignment>.999,JSON.stringify(state));report.movement.push(state);
  }
  const states=await page.evaluate(async () => {
    const THREE=await import('/node_modules/three/build/three.webgpu.js');
    const {shotYawForDirection}=await import('/src/engine/golfer.mjs');
    GOLFER_STUDY.renderer.setAnimationLoop(null);
    const turns=[],aim=[];
    for (const character of ['female','male']) {
      await GOLFER_STUDY.selectCharacter(character);
      const g=GOLFER_STUDY.golfer;
      for (const [clip,angle] of [['TurnLeft',Math.PI/2],['TurnRight',-Math.PI/2]]) {
        g.root.rotation.y=.27;g.play(clip,{fade:0});g.seek(g.duration);
        const facing=new THREE.Vector3(0,0,1).applyQuaternion(g.root.quaternion);
        const expected=new THREE.Vector3(Math.sin(.27+angle),0,Math.cos(.27+angle));
        g.play('Walk',{fade:0});g.seek(.25);
        turns.push({character,clip,turnAlignment:facing.dot(expected),retainedAlignment:new THREE.Vector3(0,0,1).applyQuaternion(g.root.quaternion).dot(expected)});
      }
      for (let i=0;i<8;i++) {
        const direction=new THREE.Vector3(Math.sin(i*Math.PI/4),0,Math.cos(i*Math.PI/4));
        g.root.rotation.y=shotYawForDirection(direction.x,direction.z);g.selectClub('Iron',false);
        aim.push({character,heading:i*45,alignment:g.shotDirection().dot(direction)});
      }
    }
    return {turns,aim};
  });
  report.turns=states.turns;report.aim=states.aim;
  for (const t of report.turns) assert(t.turnAlignment>.99999 && t.retainedAlignment>.99999,JSON.stringify(t));
  for (const a of report.aim) assert(a.alignment>.99999,JSON.stringify(a));

  for (const character of ['female','male']) {
    if (character==='female') {
      await page.goto('http://127.0.0.1:5180/?bana=puttom&golfer=1&character=female&ghibli=1&ljus=dag&q=lo&skylt=0',{waitUntil:'domcontentloaded',timeout:180000});
      await page.waitForFunction(() => window.BANVY_GOLFER && document.querySelector('#boot')?.classList.contains('done'),undefined,{timeout:180000});
    } else {
      await page.locator('.golfer-course [data-character]').selectOption(character);
      await page.waitForFunction(() => BANVY_GOLFER.golfer.character==='male',undefined,{timeout:60000});
    }
    const strikes=await page.evaluate(async () => {
      const THREE=await import('/node_modules/three/build/three.webgpu.js');
      V3D.harness().renderer.setAnimationLoop(null);
      const course=BANVY_GOLFER,g=course.golfer,results=[];
      for (const club of ['Driver','Wood','Iron','Wedge','Putter']) {
        g.selectClub(club,false);g.paused=false;
        course.panel.querySelector('[data-swing]').click();
        const clip=g.current,data=g.clips.get(clip),ball=course.ball.position.clone();
        g.seek(data.impact);g.root.updateMatrixWorld(true);
        const pos=n=>g.root.getObjectByName(n).getWorldPosition(new THREE.Vector3());
        const contact=pos('Contact_'+club),face=pos('Face_'+club).sub(contact).normalize();
        const target=new THREE.Vector3(course.target[0]-g.root.position.x,0,course.target[1]-g.root.position.z).normalize();
        const original=g.onImpact;let events=0;
        g.onImpact=event=>{events++;original(event);};
        g.play(clip,{fade:0});g.update(data.impact);
        course.update(.025);
        const travel=course.ball.position.clone().sub(ball);travel.y=0;
        results.push({character:g.character,club,contactError:contact.distanceTo(ball),faceAlignment:face.dot(target),flightAlignment:travel.normalize().dot(target),events});
        g.onImpact=original;
      }
      return results;
    });
    for (const s of strikes) {
      assert(s.contactError<.001,`${character} ${s.club}: actual course ball misses face ${s.contactError}`);
      assert(s.faceAlignment>.99 && s.flightAlignment>.99999,JSON.stringify(s));
      assert.equal(s.events,1);report.course.push(s);
    }
  }
  assert.deepEqual(report.errors,[]);
  report.passed=true;report.verifiedAt=new Date().toISOString();
  await writeFile('docs/graphics/golfer-2026-09-16/animation-audit/directions.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally { await browser.close(); }
