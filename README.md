# Auction Management System

## Overview
This project includes a Node.js backend with Prisma and a React frontend for running a real-time auction system with organizer and participant roles.

## Requirements
- Node.js 18+
- A PostgreSQL database (Supabase)

## Setup

### Backend
```bash
cd backend
npm install
npx prisma generate --schema=prisma/schema.prisma
npx prisma db push --schema=prisma/schema.prisma
npm run seed:organizer
npm start
```

### Frontend
```bash
cd frontend
npm install
npm start
```

## Usage
- Entry page: choose Organizer or Participant.
- Organizer: enter 4-digit organizer ID (printed by seed).
- Participant: enter room ID and 6-digit participant ID.
