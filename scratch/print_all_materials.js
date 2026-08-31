import { getAllMaterials } from '../db.js';

async function check() {
  const materials = await getAllMaterials();
  console.log('COUNT:', materials.length);
  console.log(JSON.stringify(materials, null, 2));
  process.exit(0);
}

check();
