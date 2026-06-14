# FairShare - Premium Expense Splitter (Frontend)

A stunning, glassmorphic React application inspired by Splitwise, built for tracking shared expenses, managing groups, and visualizing optimized debt settlements.

## ✨ Features
- **Interactive SVG Charts**: Dynamic hoverable donut charts for expense categories and visual stacked bar contribution graphs.
- **Search & Filter Chips**: Instant client-side search and quick filter chips ("All", "Involving Me", "Paid by Me", "Settlements Only").
- **Expandable Transaction Log**: Clean accordions that expand smoothly to reveal exact member splits, notes, and receipts.
- **Advanced Split Details**: Percentage sliders, share stepper buttons, and real-time visual allocation validation bars.
- **Interactive Profile Switcher**: A sleek grid of user avatar bubbles to easily simulate profile switching.
- **Toast Notifications & Dialogs**: Sleek custom toast alerts and glassmorphic modal overlays (no browser `alert`/`confirm` pops).

## 🛠️ Tech Stack
- **Framework**: React 19 (Vite)
- **Styling**: Vanilla CSS (Custom Glassmorphism)
- **Icons**: Lucide React

## 🚀 Local Installation & Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Kishan-2483/Spreetail-fairshare-fe.git
   cd Spreetail-fairshare-fe
Install dependencies:

bash
npm install
Configure Environment Variables: Create a .env file in the root directory:

env
VITE_API_BASE=http://localhost:5000/api
Run development server:

bash
npm run dev
🌐 Deployment (Vercel)
Import your frontend repository into Vercel.
Add the following environment variable in the Vercel dashboard:
VITE_API_BASE = https://your-backend-render-url.onrender.com/api
Click Deploy.
