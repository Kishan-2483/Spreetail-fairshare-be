export function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

export function normalizeName(name) {
  if (!name) return '';
  let cleaned = name.trim();
  if (cleaned.toLowerCase() === 'priya s') {
    return 'Priya'; // Map 'Priya S' to 'Priya' since it is the same person in the context of splits
  }
  // Capitalize first letter, keep rest as is or capitalize first letter of each word
  return cleaned.split(' ').map(word => {
    if (!word) return '';
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
}

export function parseDate(dateStr) {
  if (!dateStr) return '';
  let cleaned = dateStr.trim();
  
  // Match DD-MM-YYYY or DD/MM/YYYY
  const datePattern = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/;
  const match = cleaned.match(datePattern);
  if (match) {
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    const year = match[3];
    return `${year}-${month}-${day}`;
  }

  // Match Month-DD or DD-Month (e.g. Mar-14, 14-Mar, etc.)
  const monthMap = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
  };

  const monthDdPattern = /^([A-Za-z]{3})[-/](\d{1,2})$/;
  const matchMonthDd = cleaned.match(monthDdPattern);
  if (matchMonthDd) {
    const monthName = matchMonthDd[1].toLowerCase();
    const month = monthMap[monthName] || '01';
    const day = matchMonthDd[2].padStart(2, '0');
    return `2026-${month}-${day}`; // Default year to 2026 as per dataset
  }

  const ddMonthPattern = /^(\d{1,2})[-/]([A-Za-z]{3})$/;
  const matchDdMonth = cleaned.match(ddMonthPattern);
  if (matchDdMonth) {
    const day = matchDdMonth[1].padStart(2, '0');
    const monthName = matchDdMonth[2].toLowerCase();
    const month = monthMap[monthName] || '01';
    return `2026-${month}-${day}`;
  }

  // Fallback if it matches YYYY-MM-DD
  const yyyyMmDdPattern = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/;
  const matchYmd = cleaned.match(yyyyMmDdPattern);
  if (matchYmd) {
    return `${matchYmd[1]}-${matchYmd[2].padStart(2, '0')}-${matchYmd[3].padStart(2, '0')}`;
  }

  return cleaned;
}

export function parseAmount(amountStr) {
  if (!amountStr) return 0;
  // Remove commas, spaces, quotes
  let cleaned = amountStr.replace(/[\s",]/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : val;
}

export function parseCSV(csvContent) {
  const lines = csvContent.split(/\r?\n/);
  if (lines.length <= 1) return [];

  // Parse header
  const headers = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
  const dateIdx = headers.indexOf('date');
  const descIdx = headers.indexOf('description');
  const paidByIdx = headers.indexOf('paid_by');
  const amountIdx = headers.indexOf('amount');
  const currencyIdx = headers.indexOf('currency');
  const splitTypeIdx = headers.indexOf('split_type');
  const splitWithIdx = headers.indexOf('split_with');
  const splitDetailsIdx = headers.indexOf('split_details');
  const notesIdx = headers.indexOf('notes');

  const records = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const row = parseCsvLine(lines[i]);
    const date = parseDate(row[dateIdx]);
    const description = row[descIdx] ? row[descIdx].trim() : '';
    const paidByRaw = row[paidByIdx] ? row[paidByIdx].trim() : '';
    const paidBy = normalizeName(paidByRaw);
    const amount = parseAmount(row[amountIdx]);
    const currency = (row[currencyIdx] && row[currencyIdx].trim()) || 'INR'; // default to INR
    let splitType = row[splitTypeIdx] ? row[splitTypeIdx].trim().toLowerCase() : '';
    const splitWithRaw = row[splitWithIdx] ? row[splitWithIdx].trim() : '';
    const splitDetailsRaw = row[splitDetailsIdx] ? row[splitDetailsIdx].trim() : '';
    const notes = row[notesIdx] ? row[notesIdx].trim() : '';

    // If split_with is empty and splitType is empty, let's see if this is a settlement
    // e.g. "Rohan paid Aisha back" has description "Rohan paid Aisha back" and paid_by Rohan, split_with Aisha.
    // split_type is blank.
    if (!splitType && splitWithRaw && !splitWithRaw.includes(';')) {
      splitType = 'settlement';
    }

    const splitWith = splitWithRaw ? splitWithRaw.split(';').map(normalizeName).filter(Boolean) : [];
    
    // Parse split details: e.g. "Rohan 700; Priya 400" or "Aisha 30%; Rohan 30%" or "Aisha 1; Rohan 2"
    const splitDetails = {};
    if (splitDetailsRaw) {
      const parts = splitDetailsRaw.split(';');
      for (const part of parts) {
        const trimmedPart = part.trim();
        if (!trimmedPart) continue;
        
        // Find last space to split name and value (e.g. "Dev's friend Kabir 500" or "Aisha 30%")
        const lastSpaceIdx = trimmedPart.lastIndexOf(' ');
        if (lastSpaceIdx !== -1) {
          const name = normalizeName(trimmedPart.substring(0, lastSpaceIdx));
          let valStr = trimmedPart.substring(lastSpaceIdx + 1).trim();
          let isPercent = false;
          if (valStr.endsWith('%')) {
            isPercent = true;
            valStr = valStr.substring(0, valStr.length - 1);
          }
          const val = parseFloat(valStr);
          if (!isNaN(val)) {
            splitDetails[name] = { value: val, isPercent };
          }
        }
      }
    }

    records.push({
      date,
      description,
      paidBy,
      amount,
      currency,
      splitType: splitType || 'equal', // default to equal if not settlement
      splitWith,
      splitDetails,
      notes,
      rawLine: i + 1
    });
  }

  return records;
}
