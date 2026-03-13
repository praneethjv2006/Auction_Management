import React, { useState } from 'react';

const API_BASE_URL = 'https://auction-management.onrender.com/api';

export default function EntryPage({ onOrganizerLogin, onParticipantLogin }) {
  const [role, setRole] = useState('organizer');
  const [organizerCode, setOrganizerCode] = useState('');
  const [participantCode, setParticipantCode] = useState('');
  const [roomId, setRoomId] = useState('');
  const [status, setStatus] = useState('');

  async function handleOrganizerLogin(event) {
    event.preventDefault();
    setStatus('');

    try {
      const res = await fetch(`${API_BASE_URL}/organizer/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizerCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Organizer login failed');
      onOrganizerLogin(data);
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function handleParticipantLogin(event) {
    event.preventDefault();
    setStatus('');

    try {
      const res = await fetch(`${API_BASE_URL}/participants/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantCode, roomId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Participant login failed');
      onParticipantLogin({ participant: data, roomId: Number(roomId) });
    } catch (error) {
      setStatus(error.message);
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <p className="eyebrow">Auction System</p>
        <h1>Enter the auction</h1>
        <p className="hero-copy">
          Choose your role to continue. Organizers use a 4-digit ID. Participants use a 6-digit ID
          and their room ID.
        </p>
        {status ? <div className="status-banner">{status}</div> : null}
      </section>

      <section className="panel entry-panel">
        <div className="role-toggle">
          <button
            type="button"
            className={role === 'organizer' ? 'active' : ''}
            onClick={() => setRole('organizer')}
          >
            Organizer
          </button>
          <button
            type="button"
            className={role === 'participant' ? 'active' : ''}
            onClick={() => setRole('participant')}
          >
            Participant
          </button>
        </div>

        {role === 'organizer' ? (
          <form className="stack-form" onSubmit={handleOrganizerLogin}>
            <h3>Organizer login</h3>
            <input
              value={organizerCode}
              onChange={(event) => setOrganizerCode(event.target.value)}
              placeholder="4-digit organizer ID"
              maxLength={4}
              required
            />
            <button type="submit">Enter organizer dashboard</button>
          </form>
        ) : (
          <form className="stack-form" onSubmit={handleParticipantLogin}>
            <h3>Participant login</h3>
            <input
              value={roomId}
              onChange={(event) => setRoomId(event.target.value)}
              placeholder="Room ID"
              required
            />
            <input
              value={participantCode}
              onChange={(event) => setParticipantCode(event.target.value)}
              placeholder="6-digit participant ID"
              maxLength={6}
              required
            />
            <button type="submit">Enter room</button>
          </form>
        )}
      </section>
    </main>
  );
}
