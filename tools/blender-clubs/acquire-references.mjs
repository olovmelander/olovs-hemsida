import fs from 'node:fs/promises';
const destination = new URL('./references/', import.meta.url);
await fs.mkdir(destination, { recursive: true });
const photos = [
  ['iron-sole.jpg', 'https://pluggedingolf.com/wp-content/uploads/2022/08/Wilson-D9-Forged-Irons_0534.jpg'],
  ['iron-cavity.jpg', 'https://pluggedingolf.com/wp-content/uploads/2022/08/Wilson-D9-Forged-Irons_0530.jpg'],
  ['iron-0527.jpg', 'https://pluggedingolf.com/wp-content/uploads/2022/08/Wilson-D9-Forged-Irons_0527.jpg'],
  ['iron-0529.jpg', 'https://pluggedingolf.com/wp-content/uploads/2022/08/Wilson-D9-Forged-Irons_0529.jpg'],
  ['iron-0531.jpg', 'https://pluggedingolf.com/wp-content/uploads/2022/08/Wilson-D9-Forged-Irons_0531.jpg'],
  ['iron-0535.jpg', 'https://pluggedingolf.com/wp-content/uploads/2022/08/Wilson-D9-Forged-Irons_0535.jpg'],
  ['iron-0533.jpg', 'https://pluggedingolf.com/wp-content/uploads/2022/08/Wilson-D9-Forged-Irons_0533.jpg'],
  ['iron-0536.jpg', 'https://pluggedingolf.com/wp-content/uploads/2022/08/Wilson-D9-Forged-Irons_0536.jpg'],
  ['iron-product-back.png', 'https://static.golfonline.co.uk/media/img/wg1p026001_6_d9_forged_iron_flat.png'],
  ['iron-face.jpg', 'https://pluggedingolf.com/wp-content/uploads/2022/08/Wilson-D9-Forged-Irons_0532.jpg'],
  ['driver-sole.jpg', 'https://www.dormy.com/assets/blobs/02006A0B9_A-2a5d8f8277.jpeg?dpr=2&preset=small'],
  ['driver-toe.jpg', 'https://www.dormy.com/assets/blobs/02006A0B9_C-33006d1cd2.jpeg?dpr=2&preset=small'],
  ['driver-sole-alternate.jpg', 'https://www.dormy.com/assets/blobs/02006A0B9_B-6b7529f380.jpeg?dpr=2&preset=small'],
  ['fairway-sole.jpg', 'https://www.completegolfer.co.uk/images/super/wilson-dynapwr-max-golf-fairway-wood-sole-alternate-view.jpg'],
  ['fairway-sole-alternate.jpg', 'https://nz.wilson.com/cdn/shop/files/WG1P036804_2_DynaPWR_Fairway_MAX_1024x1024.jpg?v=1738623724'],
  ['fairway-hero.jpg', 'https://nz.wilson.com/cdn/shop/files/WG1P036804_0_DynaPWR_Fairway_MAX_Hero_1024x1024.jpg?v=1738623724'],
  ['fairway-crown.jpg', 'https://nz.wilson.com/cdn/shop/files/WG1P03_2_fef81f27-72d6-4066-bd29-970bae2211c6_1024x1024.jpg?v=1738623724'],
  ['fairway-strike.jpg', 'https://nz.wilson.com/cdn/shop/files/WG1P03_4_987e59b2-d89b-4808-82ec-5de6f4f792c7_1024x1024.jpg?v=1738623724'],
  ['hybrid-hero.jpg', 'https://cdn.shopify.com/s/files/1/0262/6197/9188/files/WG1P037001_0_DynaPWR_2_Hybrid_Carbon_Hero_2b9e8bfa-3488-4915-bfd0-ea188632ebbe.jpg?v=1738623702'],
  ['hybrid-crown.jpg', 'https://cdn.shopify.com/s/files/1/0262/6197/9188/files/WG1P03_2_6662e412-e001-4b94-ab11-7accf41adaf4.jpg?v=1738623701'],
  ['hybrid-sole.jpg', 'https://cdn.shopify.com/s/files/1/0262/6197/9188/files/WG1P037001_2_DynaPWR_2_Hybrid_Carbon.jpg?v=1738623701'],
  ['hybrid-face.jpg', 'https://cdn.shopify.com/s/files/1/0262/6197/9188/files/WG1P03_4_c4d3ce5f-5972-44d6-9ea6-5f119d70d5f7.jpg?v=1738623701'],
  ['hybrid-toe.jpg', 'https://cdn.shopify.com/s/files/1/0262/6197/9188/files/WG1P037001_4_DynaPWR_2_Hybrid_Carbon_Toe_Shadow_db45951b-9e99-4361-bc1a-254dff6e0633.jpg?v=1738623701'],
  ['putter-back.webp', 'https://www.scandigolf.se/cdn/shop/files/03006A0C0_A-ab64ca1ecf_700x700.webp?v=1743608675'],
  ['putter-face.webp', 'https://www.scandigolf.se/cdn/shop/files/03006A0C0_D-467b9964e8_700x700.webp?v=1743608676'],
  ['putter-address.webp', 'https://www.scandigolf.se/cdn/shop/files/03006A0C0_B-7f29a2f66b_700x700.webp?v=1743608674'],
  ['putter-cs22-hero.jpg', 'https://au.wilson.com/cdn/shop/files/WG1P034101_0_Staff_Model_CS22_Hero.png.cq5dam.web.1200.1200.jpg?v=1724995025'],
  ['putter-cs22-address.jpg', 'https://au.wilson.com/cdn/shop/files/WG1P034101_1_Staff_Model_CS22_Address.png.cq5dam.web.1200.1200.jpg?v=1724995025'],
  ['putter-cs22-face.jpg', 'https://au.wilson.com/cdn/shop/files/WG1P034101_3_Staff_Model_CS22_Face.png.cq5dam.web.1200.1200.jpg?v=1724995025'],
  ['putter-cs22-back.jpg', 'https://au.wilson.com/cdn/shop/files/WG1P034101_6_Staff_Model_CS22_Back.png.cq5dam.web.1200.1200.jpg?v=1724995025'],
  ['wedge.jpg', 'https://cdn.shopify.com/s/files/1/0061/2938/5562/files/WG1P0344R50_0_Staff_Model_ZM_Wedge_5008_Hero.png.cq5dam.web.1200.1200.jpg?v=1710970693'],
  ['wedge-zm-0.webp', 'https://cdn.shopify.com/s/files/1/0890/6722/5433/files/05006A0A0_A-cb64694292_69a1273e-a355-40f0-8db7-2ec25ecc7703.webp?v=1772547320'],
  ['wedge-zm-1.webp', 'https://cdn.shopify.com/s/files/1/0890/6722/5433/files/05006A0A0_B-32d0000efe_71961137-0629-4d74-b254-90a49598cf8f.webp?v=1772547322'],
  ['wedge-zm-2.webp', 'https://cdn.shopify.com/s/files/1/0890/6722/5433/files/05006A0A0_C-2adcc7b168_087e994a-ecb0-46c2-b7fc-f75e73ade2c8.webp?v=1772547325'],
  ['wedge-zm-3.webp', 'https://cdn.shopify.com/s/files/1/0890/6722/5433/files/05006A0A0_D-2d173bb51b_4357d355-5133-4471-99da-0c8f2f62be38.webp?v=1772547327'],
  ['wedge-zm-4.webp', 'https://cdn.shopify.com/s/files/1/0890/6722/5433/files/05006A0A0_E-fb7241a5d6_bf8a71d7-7399-4e41-bd36-43fca69de9fe.webp?v=1772547329'],
];
for (const [file, url] of photos) {
  if(process.argv.includes('--woods') && !/^(driver|fairway)-/.test(file)) continue;
  if(process.argv.includes('--hybrid') && !file.startsWith('hybrid-')) continue;
  if(process.argv.includes('--wedges') && !file.startsWith('wedge')) continue;
  if(process.argv.includes('--putter') && !file.startsWith('putter-cs22-')) continue;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await fs.writeFile(new URL(file, destination), Buffer.from(await response.arrayBuffer()));
    console.log(file);
  } catch (error) { console.error(file, error.message); }
}
await fs.writeFile(new URL('sources.json', destination), JSON.stringify(photos, null, 2));
