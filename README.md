
---

### 2. Backend Repository README (`backend/README.md`)

```markdown
# FairShare - Splitwise Core Server (Backend)

A high-performance Node.js / Express backend with an SQLite database, configured for debt settlement computations, transaction auditing, and CSV data seeding.

## ✨ Features
- **Debt Optimization Engine**: Implements the Splitwise transaction minimization algorithm to simplify complex debt structures.
- **Relational DB Architecture**: SQLite database with tables for users, groups, memberships, expenses, splits, and settlements.
- **CSV Data Importer**: A custom parser wizard to dynamically ingest spreadsheet transaction exports.
- **Secure API endpoints**: Express routes for dashboard analytics, transaction logging, and member management.
- **Dynamic Database Paths**: Automatically maps connection strings and handles folder initialization recursively for serverless/cloud environments.

## 🛠️ Tech Stack
- **Runtime**: Node.js
- **Server**: Express
- **Database**: SQLite3 (Local file-based)

## 🚀 Local Installation & Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Kishan-2483/Spreetail-fairshare-be.git
   cd Spreetail-fairshare-be
Install dependencies:

bash
npm install
Run local server:

bash
npm start
The backend server will run on http://localhost:5000.

🌐 Deployment (Render Free Tier)
Create a new Web Service on Render and link your backend repository.
Configure the following parameters:
Environment: Node
Build Command: npm install
Start Command: npm start
Render automatically starts a clean database instance in the project root directory. (Note: Data resets when the free tier service restarts or goes to sleep).
