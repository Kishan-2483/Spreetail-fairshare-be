export function computeBalances(users, expenses, splits, payments) {
  // users is array of { id, name }
  // expenses is array of { id, group_id, amount, currency, paid_by_id, split_type }
  // splits is array of { expense_id, user_id, share_amount }
  // payments is array of { id, group_id, payer_id, payee_id, amount, currency }

  const userMap = {};
  users.forEach(u => {
    userMap[u.id] = u.name;
  });

  // Collect all currencies in the data
  const currencies = new Set();
  expenses.forEach(e => currencies.add(e.currency));
  payments.forEach(p => currencies.add(p.currency));

  const results = {}; // key: currency, value: { directDebts, simplifiedDebts, netBalances, userSummaries }

  currencies.forEach(curr => {
    // 1. Compute net balance for each user
    // Net balance = (total paid/settled by user) - (total user's share of expenses)
    const netBalances = {};
    users.forEach(u => {
      netBalances[u.id] = 0;
    });

    // Add for expenses paid by user
    expenses.forEach(e => {
      if (e.currency === curr && e.paid_by_id) {
        netBalances[e.paid_by_id] += e.amount;
      }
    });

    // Subtract for user's share of expenses
    splits.forEach(s => {
      const expense = expenses.find(e => e.id === s.expense_id);
      if (expense && expense.currency === curr) {
        if (netBalances[s.user_id] !== undefined) {
          netBalances[s.user_id] -= s.share_amount;
        }
      }
    });

    // Adjust for payments (settlements)
    payments.forEach(p => {
      if (p.currency === curr) {
        if (netBalances[p.payer_id] !== undefined) {
          netBalances[p.payer_id] += p.amount; // payer gets credited (paid back)
        }
        if (netBalances[p.payee_id] !== undefined) {
          netBalances[p.payee_id] -= p.amount; // payee gets debited (received money)
        }
      }
    });

    // 2. Compute Direct Debts
    // For each expense, split users owe the payer their share amount
    const directDebts = {};
    users.forEach(uA => {
      directDebts[uA.id] = {};
      users.forEach(uB => {
        directDebts[uA.id][uB.id] = 0;
      });
    });

    expenses.forEach(e => {
      if (e.currency === curr && e.paid_by_id) {
        const expSplits = splits.filter(s => s.expense_id === e.id);
        expSplits.forEach(s => {
          if (s.user_id !== e.paid_by_id) {
            directDebts[s.user_id][e.paid_by_id] += s.share_amount;
          }
        });
      }
    });

    // Apply payments to reduce direct debts
    payments.forEach(p => {
      if (p.currency === curr) {
        // Payer A paid Payee B: reduces what A owes B
        directDebts[p.payer_id][p.payee_id] -= p.amount;
      }
    });

    // Net out direct debts between pairs
    // If A owes B $X and B owes A $Y, net it out.
    // Also handle negative debts (e.g. from overpayment) by transferring them
    const finalizedDirectDebts = [];
    
    // We net them out first
    const netPairDebts = {};
    users.forEach(uA => {
      users.forEach(uB => {
        if (uA.id < uB.id) {
          const key = `${uA.id}-${uB.id}`;
          let balance = directDebts[uA.id][uB.id] - directDebts[uB.id][uA.id];
          netPairDebts[key] = balance;
        }
      });
    });

    Object.entries(netPairDebts).forEach(([key, bal]) => {
      const [idA, idB] = key.split('-').map(Number);
      const absBal = Math.abs(bal);
      if (absBal > 0.01) {
        if (bal > 0) {
          finalizedDirectDebts.push({
            fromId: idA,
            fromName: userMap[idA],
            toId: idB,
            toName: userMap[idB],
            amount: Number(absBal.toFixed(2))
          });
        } else {
          finalizedDirectDebts.push({
            fromId: idB,
            fromName: userMap[idB],
            toId: idA,
            toName: userMap[idA],
            amount: Number(absBal.toFixed(2))
          });
        }
      }
    });

    // 3. Compute Simplified Debts
    // Use greedy matching on net balances
    const simplifiedDebts = [];
    const debtors = [];
    const creditors = [];

    Object.entries(netBalances).forEach(([userIdStr, bal]) => {
      const userId = Number(userIdStr);
      if (bal < -0.01) {
        debtors.push({ userId, name: userMap[userId], balance: bal });
      } else if (bal > 0.01) {
        creditors.push({ userId, name: userMap[userId], balance: bal });
      }
    });

    // Greedy matching
    while (debtors.length > 0 && creditors.length > 0) {
      // Sort: debtors descending by absolute debt (most negative first), creditors descending (most positive first)
      debtors.sort((a, b) => a.balance - b.balance);
      creditors.sort((a, b) => b.balance - a.balance);

      const debtor = debtors[0];
      const creditor = creditors[0];

      const debtAmount = Math.abs(debtor.balance);
      const creditAmount = creditor.balance;

      const settledAmount = Math.min(debtAmount, creditAmount);

      simplifiedDebts.push({
        fromId: debtor.userId,
        fromName: debtor.name,
        toId: creditor.userId,
        toName: creditor.name,
        amount: Number(settledAmount.toFixed(2))
      });

      debtor.balance += settledAmount;
      creditor.balance -= settledAmount;

      if (Math.abs(debtor.balance) < 0.01) {
        debtors.shift();
      }
      if (Math.abs(creditor.balance) < 0.01) {
        creditors.shift();
      }
    }

    // 4. Create User Summaries
    const userSummaries = {};
    users.forEach(u => {
      userSummaries[u.id] = {
        netBalance: Number(netBalances[u.id].toFixed(2)),
        totalOwed: 0,
        totalOwe: 0
      };
    });

    // Calculate total owed and total owe for each user using direct debts
    finalizedDirectDebts.forEach(d => {
      userSummaries[d.fromId].totalOwe += d.amount;
      userSummaries[d.toId].totalOwed += d.amount;
    });

    // Format totals
    users.forEach(u => {
      userSummaries[u.id].totalOwe = Number(userSummaries[u.id].totalOwe.toFixed(2));
      userSummaries[u.id].totalOwed = Number(userSummaries[u.id].totalOwed.toFixed(2));
    });

    results[curr] = {
      directDebts: finalizedDirectDebts,
      simplifiedDebts,
      netBalances: Object.fromEntries(
        Object.entries(netBalances).map(([k, v]) => [k, Number(v.toFixed(2))])
      ),
      userSummaries
    };
  });

  return results;
}
