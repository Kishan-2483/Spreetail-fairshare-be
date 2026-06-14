import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function test() {
  const csvPath = path.resolve(__dirname, '../expenses_export.csv');
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV file not found at ${csvPath}`);
    return;
  }
  
  const csvBuffer = fs.readFileSync(csvPath);

  // Quick login as user ID 1 (Aisha)
  const loginRes = await fetch('http://localhost:5000/api/auth/quick-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 1 })
  });
  
  if (!loginRes.ok) {
    console.error('Login failed:', await loginRes.text());
    return;
  }
  
  const loginData = await loginRes.json();
  const token = loginData.token;
  console.log('Logged in successfully. Token obtained.');

  // Create native FormData (available in Node.js 18+)
  const formData = new FormData();
  const blob = new Blob([csvBuffer], { type: 'text/csv' });
  formData.append('file', blob, 'expenses_export.csv');
  formData.append('groupName', 'Verification Group');

  console.log('Uploading CSV file to API...');
  const importRes = await fetch('http://localhost:5000/api/import', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });

  if (!importRes.ok) {
    console.error('Import API error:', await importRes.text());
    return;
  }

  const importData = await importRes.json();
  console.log('Import Status:', importData.message);
  console.log('Created Group ID:', importData.groupId);

  // Fetch group-wise balance computations
  console.log('Fetching computed balances for Group ID:', importData.groupId);
  const balancesRes = await fetch(`http://localhost:5000/api/balances?groupId=${importData.groupId}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!balancesRes.ok) {
    console.error('Balances API error:', await balancesRes.text());
    return;
  }

  const balancesData = await balancesRes.json();
  console.log('\n--- CALCULATED BALANCES SUMMARY BY CURRENCY ---');
  Object.entries(balancesData).forEach(([curr, data]) => {
    console.log(`\nCurrency: ${curr}`);
    console.log('Net Balances (positive means they are owed, negative means they owe):');
    Object.entries(data.netBalances).forEach(([userId, bal]) => {
      console.log(`  User ID ${userId}: ${bal} ${curr}`);
    });
    console.log('\nOptimized Debt Settlement Path:');
    data.simplifiedDebts.forEach(d => {
      console.log(`  ${d.fromName} pays ${d.toName} -> ${d.amount} ${curr}`);
    });
  });
}

test().catch(console.error);
