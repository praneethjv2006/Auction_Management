const express = require('express');
const cors = require('cors');
const http = require('http');
const organizerRoutes = require('./routes/organizerRoutes');
const participantRoutes = require('./routes/participantRoutes');
const roomRoutes = require('./routes/roomRoutes');
const { attachSocket } = require('./socket');
const { ensureDefaultOrganizer } = require('./controllers/organizerController');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.use('/api/organizer', organizerRoutes);
app.use('/api/participants', participantRoutes);
app.use('/api/rooms', roomRoutes);

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: 'Internal server error' });
});

attachSocket(server);

ensureDefaultOrganizer().catch((error) => {
  console.error('Failed to ensure default organizer', error);
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
