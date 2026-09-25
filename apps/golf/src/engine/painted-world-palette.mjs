// Original art direction informed by The Witness's warm/cool colour grouping.
// These are authored sRGB pigments, not sampled game assets or an official palette.
/* THE TURF, RE-HUED (2026-09-18), every colour at the brightness it had.
   Measured in HSV the mown surfaces sat at 96-136 degrees -- the green at 136 is
   TEAL, which is why it went minty the day height of cut lifted it -- where the
   turf in nine Trackman and EA reference renders sits near 71. The fairway was
   the most saturated thing on screen at 0.75. And the uncut grass was MUSTARD:
   fescue and heath at 0.62-0.70, so under the autumn light the course read as
   emerald cuts in an ochre field, two worlds with nothing between them; fescue
   gone to straw is nearer 0.45. Bunker sand was golder (0.41) than Swedish
   sand is.
   Kept on purpose: a green is COOLER than the fairway round it (the test below
   holds its blue-to-green ratio 1.5x the fairway's) -- 24 degrees now, not 30,
   and 118 is the warmest green that still passes. Saturation 0.58-0.68 is still
   above the references' 0.53-0.62, which is what a painted look is for.
   The BRIGHTNESS steps between the cuts are not here: material.js CUT_TONE. */
export const PAINTED_GROUND = {
  rough:0x567c2a, fescue:0x999050, semi:0x517929,
  fair:0x4a7827, green:0x31702f, fringe:0x426d2a, tee:0x537d2d,
  sand:0xdcc89a, path:0x8a8981, heath:0x90904d, forest:0x3f663c,
  shore:0xc0a46b, canopy:0x315c3d, canopyLight:0x6c922f,
  wet:0x527d59, rock:0x889aaf, cropA:0xc9a849, cropB:0x849c3b,
  cropC:0xbc9254, slash:0x9c7a4b, hard:0x96958d, gravel:0x81847e,
  hay:0xc7ac50, lawn:0x438021, aspT:0x565e64, aspL:0x62696d,
  soil:0x95775d, ballast:0x8c8b83, riprap:0xadb1aa, mud:0x74614f,
  trackClay:0xa68c70, trackRed:0xaa6250,
};
/* the nine colours as they were, for ?palette=classic: the A/B and the way back */
export const PAINTED_GROUND_CLASSIC = {
  ...PAINTED_GROUND,
  rough:0x527e26, fescue:0xa78f32, semi:0x487d25,
  fair:0x367f20, green:0x28713c, fringe:0x3a7029, tee:0x458328,
  sand:0xe3c887, heath:0x979039,
};
/** Anything but the one known name is the current palette: a shared link must open. */
export function paintedGroundPalette(search = globalThis.location?.search || '') {
  return new URLSearchParams(search).get('palette') === 'classic' ? PAINTED_GROUND_CLASSIC : PAINTED_GROUND;
}
export const PAINTED_SCENERY = {
  wallRed:0xb44830, wallOchre:0xe0bb66, wallCream:0xded4ac,
  wallGrey:0x9ca399, wallWood:0x92795c, roofSlate:0x505e69,
  roofClay:0x995e48, trim:0xf0ead7, industrial:0x9faeb0, clubhouse:0xe7dfc5,
  stone:0x8899a5, wood:0x804b2c, cutWood:0xd0aa65,
  tuft:[0x557331,0xb4a343], bush:[0x3f733d,0x91973c],
};
export const FOLIAGE_PALETTES = {
  // Visby martall: muted blue/grey-green needles and restrained olive tips.
  // Selected by its catalogue so close meshes and distant impostors agree.
  martall:[0x182e27,0x385343,0x738368],
  // Stronger green midtones and less chalky yellow in sunlit crowns.
  tall:[0x193c2b,0x3c7328,0x7ba638], gran:[0x183b2e,0x2e6334,0x60963f],
  bjork:[0x284b20,0x5b9425,0x99bd36], al:[0x1d472b,0x40822d,0x83b33c],
  ek:[0x304a1d,0x689023,0xafb933],
};
// One hue family per crown; narrow crossovers avoid muddy green/orange blends.
// Birch is predominantly gold, oak carries the strongest copper and crimson.
export const AUTUMN_FOLIAGE = {
  bjork:{ breaks:[.63,.90], ramps:[
    [0x80521a,0xdda01e,0xffd54b], [0x87351c,0xdd701b,0xffab34], [0x77252b,0xc14727,0xf27b38],
  ] },
  ek:{ breaks:[.30,.68], ramps:[
    [0x785019,0xcb901f,0xf4be40], [0x822c17,0xdb591c,0xfa912e], [0x691f34,0xb92f2d,0xee6537],
  ] },
  al:{ breaks:[.74,.94], ramps:[
    [0x30462b,0x698532,0xacb548], [0x63511e,0xb49a2c,0xe7bf42], [0x754220,0xbb792b,0xe7a342],
  ] },
};

// The same eight atmosphere identities, with lighting and pigments composed
// together. Kept separate so the natural rendering mode retains its palette.
// cloudShadow: the share of the ground in a cloud's shade and how much of the
// sun that shade takes (cloud-shadow.mjs), in each preset with a sun; lighter
// than a tree's shadow, lightest where a low sun is thin already. valleyMist:
// the mist lying in the low ground (aerial-perspective.mjs), density per metre
// at the course's low ground and the height it thins over, at dawn and in mist.
// bloomThreshold, skyCloudGlow: the glow at a low sun (glow.mjs): the threshold,
// just above the preset's broad sky, cloud and haze paint (0.86 where unset),
// and how far past their paint the clouds' centres shine at the sun, so they
// are what crosses it.
export const PAINTED_ATMOSPHERES = {
  noon:{ sun:0xfff0d7, int:2.35, hemiS:0xadc9df, hemiG:0x879c76, hemiI:1.28,
    fog:0x8dbdd0, paintedFog:0x8dbdd0, exp:1.00, paintedFill:1.0, groundStrength:.85,
    skyPalette:.10, skyZenith:0x146ab6, skyHorizon:0x91cadc, skyRadiance:.05, paintedSkyExposure:1, cloud:.28,
    environment:{ground:0xa8ad91,horizon:0xc5dde2,zenith:0x579bc4},
    foliage:{strength:1.04,direct:.95}, water:[0x228b9d,0x164c88], waterLight:1, sparkle:.18,
    shadowSky:.12, cloudShadow:{cover:.30,opacity:.62},
  },
  // A cloudless summer day: a deep blue zenith over a pale, luminous horizon,
  // a high afternoon sun, clear air, fresh greens and bright water. No clouds,
  // so no cloud shadows and no cloud paint.
  summer:{ sun:0xfff3dc, int:2.45, hemiS:0xa8c9e6, hemiG:0x879c76, hemiI:1.25,
    fog:0x94c3d8, paintedFog:0x9ac6dc, exp:1.00, paintedFill:1.0, groundStrength:.87,
    skyPalette:.10, skyZenith:0x0f5cc4, skyHorizon:0x8ecbea, skyRadiance:.05, paintedSkyExposure:1, cloud:0, cloudDensity:0,
    skySunGlow:0xfff6e0, skySunGlowStrength:.15,
    environment:{ground:0xa8ad91,horizon:0xbcdcee,zenith:0x4389cc},
    foliage:{strength:1.08,direct:.96}, water:[0x1c8ea6,0x10498c], waterLight:1, sparkle:.35,
    shadowSky:.13,
  },
  // Low honey-coloured sunlight, cool open shade and a sunward amber glow.
  golden:{ sun:0xffcc8c, int:3.80, hemiS:0x95aed0, hemiG:0xb0a783, hemiI:1.40,
    fog:0xd3b597, paintedFog:0xcab4a2, exp:1.12, paintedFill:1.0,
    skyPalette:.24, skyZenith:0x397cba, skyHorizon:0xa9bfd2, skyRadiance:.46, paintedSkyExposure:.95, cloud:.24,
    skyCloudLit:0xffd49b, skyCloudShade:0x8f9ebb,
    skySunGlow:0xffb65e, skySunGlowStrength:.92, hazeGlow:.5,
    environment:{ground:0xab956e,horizon:0xe8bb85,zenith:0x648bb8}, environmentIntensity:.48,
    foliage:{strength:1.20,direct:.96,sunWhite:.18,shadowWhite:.38,back:.42},
    water:[0x438b87,0x24577f], waterLight:.94, sparkle:.36,
    shadowSky:.10, cloudShadow:{cover:.22,opacity:.55}, bloomThreshold:.70, skyCloudGlow:.5,
  },
  dawn:{ sun:0xffd8c4, int:1.65, hemiS:0xbccbe0, hemiG:0xaca595, hemiI:1.75,
    fog:0xbcbacb, paintedFog:0xbfc9dc, exp:1.10, paintedFill:1.06,
    skyZenith:0x527dbd, skyHorizon:0xf4acb6, skyRadiance:.65, paintedSkyExposure:.62,
    skyCloudLit:0xedd0d7, skyCloudShade:0x818eac,
    skySunGlow:0xffc79a, skySunGlowStrength:.72, hazeGlow:.5,
    environment:{ground:0xaaa697,horizon:0xdcc3d0,zenith:0x809bc4},
    foliage:{strength:.91,direct:.57,back:.30}, water:[0x789ea8,0x446789], waterLight:.83, sparkle:.32,
    shadowSky:.12, cloudShadow:{cover:.30,opacity:.45}, valleyMist:{density:.0016,height:6},
    bloomThreshold:.60, skyCloudGlow:1.31,
  },
  midnight:{ sun:0xffb76c, int:1.90, hemiS:0xb4bed8, hemiG:0xb09d89, hemiI:2.05,
    fog:0xaba0ae, paintedFog:0xa3a7c1, exp:1.13, paintedFill:1.04,
    skyPalette:.35, skyZenith:0x596baa, skyHorizon:0xedaf77, skyRadiance:.40, paintedSkyExposure:.64,
    skyCloudLit:0xecc6a4, skyCloudShade:0x7f859e,
    skySunGlow:0xffc27c, skySunGlowStrength:.70, hazeGlow:.5,
    environment:{ground:0xaaa08d,horizon:0xddb496,zenith:0x798db5},
    foliage:{strength:.90,direct:.70,back:.38}, water:[0x7b9c9e,0x4a6285], waterLight:.84, sparkle:.45,
    shadowSky:.11, cloudShadow:{cover:.18,opacity:.45}, bloomThreshold:.50, skyCloudGlow:2.16,
  },
  bluehour:{ hemiS:0xa7bddf, hemiG:0x8896a5, hemiI:1.85,
    fog:0x879cba, paintedFog:0x879cba, paintedFill:1.04,
    skyZenith:0x284b95, skyHorizon:0xa894c7, paintedSkyExposure:.20,
    skyCloudLit:0x9399b8, skyCloudShade:0x4e5d7e,
    environment:{ground:0x8896a5,horizon:0x9aacc9,zenith:0x5474a9},
    foliage:{strength:.64,direct:.03}, water:[0x6c92aa,0x405d83], waterLight:.64, sparkle:.015,
  },
  storm:{ hemiS:0xb6c8d3, hemiG:0x8b9b98, hemiI:1.70,
    fog:0x879da9, paintedFog:0x879da9, paintedFill:1.03,
    skyZenith:0x456179, skyHorizon:0x96afbc, paintedSkyExposure:.46,
    skyCloudLit:0x9aaeba, skyCloudShade:0x5d7186,
    environment:{ground:0x8b9b98,horizon:0x9aafb8,zenith:0x607a91},
    foliage:{strength:.71,direct:.12}, water:[0x729595,0x3f6576], waterLight:.70, sparkle:.06,
  },
  mist:{ hemiS:0xd7e2e3, hemiG:0xadb6a3, hemiI:1.85,
    fog:0xb3c6c6, paintedFog:0xc3d4d3, paintedFill:1.03,
    skyZenith:0xa6bdc6, skyHorizon:0xdbe3df, paintedSkyExposure:.86,
    skyCloudLit:0xd8e2df, skyCloudShade:0x9baeb4,
    environment:{ground:0xadb6a3,horizon:0xd2dfdd,zenith:0xa9c1ca},
    foliage:{strength:.85,direct:.08}, water:[0x91b1a9,0x658e98], waterLight:.88, sparkle:.025,
    valleyMist:{density:.0022,height:9},
  },
  host:{ sun:0xffdda9, int:2.25, hemiS:0xbfcfdf, hemiG:0xb4a285, hemiI:1.65,
    fog:0xa8c4d1, paintedFog:0xaccbdb, dens:.00035, exp:1.10, paintedFill:1.06,
    skyPalette:.30, skyZenith:0x226db1, skyHorizon:0xaed2dd, skyRadiance:.46, paintedSkyExposure:.97, cloud:.34,
    skyCloudLit:0xffedcf, skyCloudShade:0x9aaec4,
    skySunGlow:0xfff0d0, skySunGlowStrength:.40, hazeGlow:.4,
    environment:{ground:0xb4a285,horizon:0xddd0b8,zenith:0x769fc1},
    foliage:{strength:1.14,direct:.92,back:.30}, water:[0x2f858e,0x1b5084], waterLight:.96, sparkle:.46,
    leaf:0xd6a442, reed:0xbe9855,
    shadowSky:.11, cloudShadow:{cover:.32,opacity:.60}, skyCloudGlow:.27,
  },
};

export function paintedAtmosphere(name, base) {
  return {...base,grassSheen:.36,...PAINTED_ATMOSPHERES[name]};
}
