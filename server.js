import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { initDb, query, run, get } from './db.js';
import { parseCSV } from './parser.js';
import { computeBalances } from './balancer.js';

const app = express();
const port = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_12345';

// Configure Multer for file uploads (memory storage)
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

// Initialize database
initDb().then(async () => {
  // Seed default users if table is empty
  const userCount = await get('SELECT COUNT(*) as count FROM users');
  if (userCount.count === 0) {
    const defaultUsers = ['Aisha', 'Rohan', 'Priya', 'Dev', 'Meera', 'Sam', 'Kabir'];
    const passwordHash = await bcrypt.hash('password123', 10);
    for (const name of defaultUsers) {
      await run(
        'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
        [name, `${name.toLowerCase()}@example.com`, passwordHash]
      );
    }
    console.log('Default users seeded.');
  }
}).catch(err => {
  console.error('Database initialization failed:', err);
});

// Middleware: Authenticate User by header X-User-Id (No passwords/JWT)
async function authenticateToken(req, res, next) {
  const userIdHeader = req.headers['x-user-id'];
  const userId = userIdHeader ? parseInt(userIdHeader, 10) : 1;
  try {
    const user = await get('SELECT id, name FROM users WHERE id = ?', [userId]);
    if (!user) {
      const firstUser = await get('SELECT id, name FROM users ORDER BY id ASC LIMIT 1');
      req.user = firstUser || { id: 1, name: 'Aisha' };
    } else {
      req.user = user;
    }
    next();
  } catch (err) {
    req.user = { id: 1, name: 'Aisha' };
    next();
  }
}

// --- Auth Routes ---

// Get all users (useful for dropdowns and quick login)
app.get('/api/users', async (req, res) => {
  try {
    const users = await query('SELECT id, name, email FROM users');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Register User
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await run(
      'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
      [name, email || `${name.toLowerCase()}@example.com`, passwordHash]
    );
    const token = jwt.sign({ id: result.id, name }, JWT_SECRET, { expiresIn: '24h' });
    res.status(201).json({ token, user: { id: result.id, name } });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      res.status(400).json({ error: 'Username or email already exists' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// Login User
app.post('/api/auth/login', async (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  try {
    const user = await get('SELECT * FROM users WHERE name = ?', [name]);
    if (!user) return res.status(400).json({ error: 'User not found' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(400).json({ error: 'Incorrect password' });

    const token = jwt.sign({ id: user.id, name: user.name }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { id: user.id, name: user.name } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Quick Switch Login (No password check, dev utility)
app.post('/api/auth/quick-login', async (req, res) => {
  const { userId } = req.body;
  try {
    const user = await get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(400).json({ error: 'User not found' });

    const token = jwt.sign({ id: user.id, name: user.name }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { id: user.id, name: user.name } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Current User Profile
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  res.json({ user: req.user });
});

// --- Group Routes ---

// List groups
app.get('/api/groups', authenticateToken, async (req, res) => {
  try {
    // Return groups that the user is currently in or has historically been in
    const groups = await query(`
      SELECT DISTINCT g.* FROM groups g
      JOIN group_memberships gm ON g.id = gm.group_id
      WHERE gm.user_id = ?
    `, [req.user.id]);
    res.json(groups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create group
app.post('/api/groups', authenticateToken, async (req, res) => {
  const { name, members } = req.body; // members is array of userIds
  if (!name) return res.status(400).json({ error: 'Group name required' });
  try {
    const result = await run('INSERT INTO groups (name) VALUES (?)', [name]);
    const groupId = result.id;

    // Add creator to group
    await run(
      'INSERT INTO group_memberships (group_id, user_id) VALUES (?, ?)',
      [groupId, req.user.id]
    );

    // Add other members
    if (members && Array.isArray(members)) {
      for (const memberId of members) {
        if (memberId !== req.user.id) {
          await run(
            'INSERT INTO group_memberships (group_id, user_id) VALUES (?, ?)',
            [groupId, memberId]
          );
        }
      }
    }

    res.status(201).json({ id: groupId, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get group details
app.get('/api/groups/:id', authenticateToken, async (req, res) => {
  try {
    const group = await get('SELECT * FROM groups WHERE id = ?', [req.params.id]);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    // Get members (both active and historical)
    const members = await query(`
      SELECT u.id, u.name, u.email, gm.joined_at, gm.left_at
      FROM users u
      JOIN group_memberships gm ON u.id = gm.user_id
      WHERE gm.group_id = ?
    `, [req.params.id]);

    res.json({ ...group, members });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add member to group
app.post('/api/groups/:id/members', authenticateToken, async (req, res) => {
  const { userId } = req.body;
  const groupId = req.params.id;
  try {
    // Check if membership already exists (active or left)
    const existing = await get(
      'SELECT * FROM group_memberships WHERE group_id = ? AND user_id = ?',
      [groupId, userId]
    );

    if (existing) {
      if (existing.left_at) {
        // Re-join: clear left_at
        await run(
          'UPDATE group_memberships SET left_at = NULL, joined_at = CURRENT_TIMESTAMP WHERE id = ?',
          [existing.id]
        );
      } else {
        return res.status(400).json({ error: 'User is already a member of this group' });
      }
    } else {
      // Create new membership
      await run(
        'INSERT INTO group_memberships (group_id, user_id) VALUES (?, ?)',
        [groupId, userId]
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Leave group
app.post('/api/groups/:id/members/leave', authenticateToken, async (req, res) => {
  const { userId } = req.body;
  const groupId = req.params.id;
  try {
    await run(
      'UPDATE group_memberships SET left_at = CURRENT_TIMESTAMP WHERE group_id = ? AND user_id = ? AND left_at IS NULL',
      [groupId, userId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Expense Routes ---

// Get expenses (optionally filtered by group)
app.get('/api/expenses', authenticateToken, async (req, res) => {
  const { groupId } = req.query;
  try {
    let sql = `
      SELECT e.*, u.name as paid_by_name, g.name as group_name
      FROM expenses e
      LEFT JOIN users u ON e.paid_by_id = u.id
      LEFT JOIN groups g ON e.group_id = g.id
    `;
    const params = [];
    
    if (groupId) {
      sql += ' WHERE e.group_id = ?';
      params.push(groupId);
    } else {
      // Global expenses for the user (where they are paid_by or split_with)
      sql += `
        WHERE e.group_id IN (
          SELECT group_id FROM group_memberships WHERE user_id = ?
        ) OR e.id IN (
          SELECT expense_id FROM expense_splits WHERE user_id = ?
        )
      `;
      params.push(req.user.id, req.user.id);
    }
    
    sql += ' ORDER BY e.date DESC, e.id DESC';
    const expenses = await query(sql, params);

    // Get splits for each expense
    for (const exp of expenses) {
      exp.splits = await query(`
        SELECT s.*, u.name as user_name
        FROM expense_splits s
        JOIN users u ON s.user_id = u.id
        WHERE s.expense_id = ?
      `, [exp.id]);
    }

    res.json(expenses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create expense
app.post('/api/expenses', authenticateToken, async (req, res) => {
  const { groupId, description, amount, currency, paidById, splitType, splits, date, notes } = req.body;
  
  if (!description || amount === undefined || !splitType || !splits || splits.length === 0) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const expenseResult = await run(`
      INSERT INTO expenses (group_id, description, amount, currency, paid_by_id, split_type, date, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [groupId || null, description, amount, currency || 'INR', paidById || null, splitType, date || new Date().toISOString().split('T')[0], notes || '']);
    
    const expenseId = expenseResult.id;

    for (const split of splits) {
      // split should contain user_id, share_amount, and raw_value
      await run(`
        INSERT INTO expense_splits (expense_id, user_id, share_amount, raw_value)
        VALUES (?, ?, ?, ?)
      `, [expenseId, split.userId, split.shareAmount, split.rawValue || null]);
    }

    res.status(201).json({ id: expenseId, description, amount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete expense
app.delete('/api/expenses/:id', authenticateToken, async (req, res) => {
  try {
    await run('DELETE FROM expenses WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Settlement/Payment Routes ---

// Record payment (settlement)
app.post('/api/payments', authenticateToken, async (req, res) => {
  const { groupId, payerId, payeeId, amount, currency, date, notes } = req.body;
  if (!payerId || !payeeId || !amount) {
    return res.status(400).json({ error: 'Payer, payee, and amount are required' });
  }
  try {
    const result = await run(`
      INSERT INTO payments (group_id, payer_id, payee_id, amount, currency, date, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [groupId || null, payerId, payeeId, amount, currency || 'INR', date || new Date().toISOString().split('T')[0], notes || '']);
    res.status(201).json({ id: result.id, payerId, payeeId, amount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List payments
app.get('/api/payments', authenticateToken, async (req, res) => {
  const { groupId } = req.query;
  try {
    let sql = `
      SELECT p.*, u1.name as payer_name, u2.name as payee_name, g.name as group_name
      FROM payments p
      JOIN users u1 ON p.payer_id = u1.id
      JOIN users u2 ON p.payee_id = u2.id
      LEFT JOIN groups g ON p.group_id = g.id
    `;
    const params = [];

    if (groupId) {
      sql += ' WHERE p.group_id = ?';
      params.push(groupId);
    } else {
      sql += ' WHERE p.payer_id = ? OR p.payee_id = ?';
      params.push(req.user.id, req.user.id);
    }

    sql += ' ORDER BY p.date DESC, p.id DESC';
    const payments = await query(sql, params);
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete payment
app.delete('/api/payments/:id', authenticateToken, async (req, res) => {
  try {
    await run('DELETE FROM payments WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Balance Summaries ---

// Get balances (Group-wise or Global)
app.get('/api/balances', authenticateToken, async (req, res) => {
  const { groupId } = req.query;
  try {
    let users, expenses, splits, payments;

    if (groupId) {
      // Group specific
      users = await query(`
        SELECT u.id, u.name FROM users u
        JOIN group_memberships gm ON u.id = gm.user_id
        WHERE gm.group_id = ?
      `, [groupId]);

      expenses = await query('SELECT * FROM expenses WHERE group_id = ?', [groupId]);
      splits = await query(`
        SELECT s.* FROM expense_splits s
        JOIN expenses e ON s.expense_id = e.id
        WHERE e.group_id = ?
      `, [groupId]);

      payments = await query('SELECT * FROM payments WHERE group_id = ?', [groupId]);
    } else {
      // Global (across all groups user belongs to)
      users = await query('SELECT id, name FROM users');
      expenses = await query(`
        SELECT DISTINCT e.* FROM expenses e
        WHERE e.group_id IN (
          SELECT group_id FROM group_memberships WHERE user_id = ?
        ) OR e.group_id IS NULL
      `, [req.user.id]);

      const expenseIds = expenses.map(e => e.id);
      if (expenseIds.length > 0) {
        const placeHolders = expenseIds.map(() => '?').join(',');
        splits = await query(`SELECT * FROM expense_splits WHERE expense_id IN (${placeHolders})`, expenseIds);
      } else {
        splits = [];
      }

      payments = await query(`
        SELECT DISTINCT p.* FROM payments p
        WHERE p.group_id IN (
          SELECT group_id FROM group_memberships WHERE user_id = ?
        ) OR p.group_id IS NULL
      `, [req.user.id]);
    }

    const calculatedBalances = computeBalances(users, expenses, splits, payments);
    res.json(calculatedBalances);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- CSV Import ---

app.post('/api/import', authenticateToken, upload.single('file'), async (req, res) => {
  const { groupName } = req.body;
  if (!req.file) return res.status(400).json({ error: 'CSV file is required' });

  try {
    const csvText = req.file.buffer.toString('utf-8');
    const parsedRecords = parseCSV(csvText);

    // 1. Collect all unique user names from the CSV
    const names = new Set();
    parsedRecords.forEach(r => {
      if (r.paidBy) names.add(r.paidBy);
      r.splitWith.forEach(name => names.add(name));
      Object.keys(r.splitDetails).forEach(name => names.add(name));
    });

    const nameList = Array.from(names);
    if (nameList.length === 0) {
      return res.status(400).json({ error: 'No users found in CSV' });
    }

    // 2. Ensure all users exist in the database
    const userMap = {}; // key: name, value: id
    const passwordHash = await bcrypt.hash('password123', 10);
    
    for (const name of nameList) {
      let user = await get('SELECT id FROM users WHERE name = ? COLLATE NOCASE', [name]);
      if (!user) {
        const insertRes = await run(
          'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
          [name, `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}@example.com`, passwordHash]
        );
        userMap[name] = insertRes.id;
      } else {
        userMap[name] = user.id;
      }
    }

    // Since SQLite collation might cause case variations, retrieve the correct normalized names
    const dbUsers = await query('SELECT id, name FROM users');
    const dbUserMap = {};
    dbUsers.forEach(u => {
      dbUserMap[u.name.toLowerCase()] = u.id;
    });

    // Helper to resolve ID from user name (case insensitive)
    const getUserId = (name) => dbUserMap[name.toLowerCase()] || null;

    // 3. Create or identify the Group
    let groupId;
    const finalGroupName = groupName || 'Imported Shared Group';
    const existingGroup = await get('SELECT id FROM groups WHERE name = ?', [finalGroupName]);
    if (existingGroup) {
      groupId = existingGroup.id;
    } else {
      const groupRes = await run('INSERT INTO groups (name) VALUES (?)', [finalGroupName]);
      groupId = groupRes.id;
    }

    // 4. Ensure all users are added as group members
    for (const name of nameList) {
      const uId = getUserId(name);
      if (uId) {
        const mem = await get(
          'SELECT id FROM group_memberships WHERE group_id = ? AND user_id = ?',
          [groupId, uId]
        );
        if (!mem) {
          await run(
            'INSERT INTO group_memberships (group_id, user_id) VALUES (?, ?)',
            [groupId, uId]
          );
        }
      }
    }

    // 5. Import Expenses & Payments
    let importedExpenses = 0;
    let importedPayments = 0;

    for (const rec of parsedRecords) {
      const paidById = getUserId(rec.paidBy);
      const dateStr = rec.date;

      if (rec.splitType === 'settlement') {
        // Record as payment
        // rec.splitWith contains the payee. If empty, skip
        if (rec.splitWith.length > 0) {
          const payeeId = getUserId(rec.splitWith[0]);
          if (paidById && payeeId) {
            await run(`
              INSERT INTO payments (group_id, payer_id, payee_id, amount, currency, date, notes)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [groupId, paidById, payeeId, rec.amount, rec.currency, dateStr, rec.notes || 'CSV Import Settlement']);
            importedPayments++;
          }
        }
      } else {
        // Record as expense
        // Determine splits
        const splitUsers = rec.splitWith;
        if (splitUsers.length === 0) continue;

        const splitsToInsert = [];
        
        if (rec.splitType === 'equal') {
          const share = rec.amount / splitUsers.length;
          splitUsers.forEach(name => {
            const uId = getUserId(name);
            if (uId) {
              splitsToInsert.push({ userId: uId, shareAmount: share, rawValue: 1 });
            }
          });
        } else if (rec.splitType === 'unequal') {
          // Use splitDetails raw values
          splitUsers.forEach(name => {
            const uId = getUserId(name);
            const detail = rec.splitDetails[name];
            const val = detail ? detail.value : 0;
            if (uId) {
              splitsToInsert.push({ userId: uId, shareAmount: val, rawValue: val });
            }
          });
        } else if (rec.splitType === 'percentage') {
          // Use splitDetails percentage values
          splitUsers.forEach(name => {
            const uId = getUserId(name);
            const detail = rec.splitDetails[name];
            const pct = detail ? detail.value : 0;
            const share = rec.amount * (pct / 100);
            if (uId) {
              splitsToInsert.push({ userId: uId, shareAmount: share, rawValue: pct });
            }
          });
        } else if (rec.splitType === 'share') {
          // Use splitDetails share values
          let totalWeight = 0;
          splitUsers.forEach(name => {
            const detail = rec.splitDetails[name];
            totalWeight += detail ? detail.value : 0;
          });

          if (totalWeight > 0) {
            splitUsers.forEach(name => {
              const uId = getUserId(name);
              const detail = rec.splitDetails[name];
              const weight = detail ? detail.value : 0;
              const share = rec.amount * (weight / totalWeight);
              if (uId) {
                splitsToInsert.push({ userId: uId, shareAmount: share, rawValue: weight });
              }
            });
          }
        }

        if (splitsToInsert.length > 0) {
          const expRes = await run(`
            INSERT INTO expenses (group_id, description, amount, currency, paid_by_id, split_type, date, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `, [groupId, rec.description, rec.amount, rec.currency, paidById, rec.splitType, dateStr, rec.notes]);
          
          const expId = expRes.id;
          for (const s of splitsToInsert) {
            await run(`
              INSERT INTO expense_splits (expense_id, user_id, share_amount, raw_value)
              VALUES (?, ?, ?, ?)
            `, [expId, s.userId, s.shareAmount, s.rawValue]);
          }
          importedExpenses++;
        }
      }
    }

    res.json({
      success: true,
      message: `Imported ${importedExpenses} expenses and ${importedPayments} settlements successfully.`,
      groupId,
      groupName: finalGroupName
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
