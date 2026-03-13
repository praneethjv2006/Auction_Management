import React, { useEffect, useState } from 'react';

const API_BASE_URL = `http://${window.location.hostname}:4000/api`;

export default function AuctionRoomPage({ roomId, onBack }) {
  const [room, setRoom] = useState(null);
  const [status, setStatus] = useState('Loading...');

  useEffect(() => {
    async function fetchRoom() {
      try {
        const res = await fetch(`${API_BASE_URL}/rooms/${roomId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load room');
        setRoom(data);
        setStatus('');
      } catch (e) {
        setStatus(e.message);
      }
    }
    fetchRoom();
  }, [roomId]);

  if (status) return <div className="status-banner">{status}</div>;
  if (!room) return null;

  return (
    <div className="auction-room-page">
      <button onClick={onBack} style={{ marginBottom: 16 }}>&larr; Back to dashboard</button>
      <h2>Auction Room: {room.roomName}</h2>
      <div className="room-meta">
        <span>Room ID: {room.id}</span>
        <span>Status: {room.status}</span>
      </div>
      <div className="lists-grid">
        <section>
          <h3>Participants</h3>
          <div className="info-list">
            {room.participants.map((p) => (
              <div key={p.id} className="info-card">
                <strong>{p.name}</strong>
                <span>ID: {p.id}</span>
                <span>Purse Remaining: {p.remainingPurse}</span>
              </div>
            ))}
            {room.participants.length === 0 && <p>No participants yet.</p>}
          </div>
        </section>
        <section>
          <h3>Items</h3>
          <div className="info-list">
            {room.items.map((item) => (
              <div key={item.id} className="info-card">
                <strong>{item.name}</strong>
                <span>ID: {item.id}</span>
                <span>Price: {item.price}</span>
              </div>
            ))}
            {room.items.length === 0 && <p>No items yet.</p>}
          </div>
        </section>
      </div>
      <button style={{ marginTop: 24, fontWeight: 700, fontSize: 18 }}>
        Start Auction
      </button>
    </div>
  );
}
