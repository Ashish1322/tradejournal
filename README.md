# Trading Journal App (React + Firebase)

This app helps you maintain a rule-focused trading journal with a dashboard.

## What is included

- Add trade entries with:
	- Script (GOLD or BTC)
	- Points captured
	- Profit/Loss (PnL)
	- Setup and source
- Rule-based calendar day colors:
	- Green: rules followed
	- Red: rules broken
	- Tile also shows that day PnL
- Click a day to see all trades of that day
- Dashboard includes:
	- Total PnL till now
	- PnL by strategy/setup
	- Count of days rules followed and rules broken

## Your trading rules implemented

- GOLD must be 1 lot
- Maximum trades per day: 5
- Self trades per day: up to 2
- Live Stream trades per day: up to 3

## Setup

1. Install dependencies:

```bash
npm install
```

2. Set Firebase environment values:

```bash
cp .env.example .env
```

Then fill actual Firebase values in `.env`.

3. Run the app:

```bash
npm run dev
```

## Firebase notes

- App stores trades in Firestore collection: `trades`
- If Firebase environment values are missing, app automatically uses local browser storage
