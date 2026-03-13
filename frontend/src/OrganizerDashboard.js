import React, { useEffect, useEffectEvent, useState } from 'react';

const API_BASE_URL = 'https://auction-management.onrender.com/api';

export default function OrganizerDashboard({ organizer, onEnterRoom, onLogout }) {
  const [rooms, setRooms] = useState([]);
  const [selectedRoomId, setSelectedRoomId] = useState(null);
  const [roomName, setRoomName] = useState('');
  const [participantName, setParticipantName] = useState('');
  const [participantPurse, setParticipantPurse] = useState('');
  const [itemName, setItemName] = useState('');
  const [itemPrice, setItemPrice] = useState('');
  const [status, setStatus] = useState('Loading rooms...');

  const selectedRoom = rooms.find((room) => room.id === selectedRoomId) || null;

  async function fetchJson(path, options) {
    const response = await fetch(`${API_BASE_URL}${path}`, options);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }

    return data;
  }

  const loadRooms = useEffectEvent(async () => {
    try {
      const roomsResponse = await fetchJson(`/rooms?organizerId=${organizer.id}`);
      setRooms(roomsResponse);
      setSelectedRoomId((currentRoomId) => {
        if (currentRoomId && roomsResponse.some((room) => room.id === currentRoomId)) {
          return currentRoomId;
        }
        return roomsResponse[0]?.id ?? null;
      });
      setStatus('Rooms loaded.');
    } catch (error) {
      setStatus(error.message || 'Could not connect to backend.');
    }
  });

  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  async function handleCreateRoom(event) {
    event.preventDefault();

    try {
      const newRoom = await fetchJson('/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName, organizerId: organizer.id }),
      });

      setRoomName('');
      setStatus(`Room ${newRoom.roomName} created.`);
      await loadRooms();
      setSelectedRoomId(newRoom.id);
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function handleAddParticipant(event) {
    event.preventDefault();

    if (!selectedRoom) {
      setStatus('Create and open a room first.');
      return;
    }

    try {
      const participant = await fetchJson(`/rooms/${selectedRoom.id}/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: participantName,
          purseAmount: participantPurse,
        }),
      });

      setParticipantName('');
      setParticipantPurse('');
      setStatus(`Participant created with ID ${participant.participantCode}.`);
      await loadRooms();
      setSelectedRoomId(selectedRoom.id);
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function handleAddItem(event) {
    event.preventDefault();

    if (!selectedRoom) {
      setStatus('Create and open a room first.');
      return;
    }

    try {
      const item = await fetchJson(`/rooms/${selectedRoom.id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: itemName,
          price: itemPrice,
        }),
      });

      setItemName('');
      setItemPrice('');
      setStatus(`Item ${item.name} added to room.`);
      await loadRooms();
      setSelectedRoomId(selectedRoom.id);
    } catch (error) {
      setStatus(error.message);
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <p className="eyebrow">Organizer Dashboard</p>
        <h1>Organizer room control</h1>
        <p className="hero-copy">
          Organizer ID: <strong>{organizer.organizerCode}</strong>. Create rooms, add participants
          and items, then enter an auction room to control the flow.
        </p>
        <div className="status-banner">{status}</div>
        <button className="ghost-button" type="button" onClick={onLogout}>
          Log out
        </button>
      </section>

      <section className="workspace-grid">
        <article className="panel">
          <h2>Organizer</h2>
          <div className="organizer-card">
            <div>
              <span className="label">ID</span>
              <strong>{organizer.organizerCode}</strong>
            </div>
            <div>
              <span className="label">Name</span>
              <strong>{organizer.name}</strong>
            </div>
            <div>
              <span className="label">Email</span>
              <strong>{organizer.email || 'No email'}</strong>
            </div>
          </div>

          <form className="stack-form" onSubmit={handleCreateRoom}>
            <h3>Create room</h3>
            <input
              value={roomName}
              onChange={(event) => setRoomName(event.target.value)}
              placeholder="Room name"
              required
            />
            <button type="submit">Create room</button>
          </form>
        </article>

        <article className="panel">
          <div className="panel-header">
            <h2>Rooms</h2>
            <span>{rooms.length} total</span>
          </div>
          <div className="room-list">
            {rooms.map((room) => (
              <div key={room.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  type="button"
                  className={`room-card ${selectedRoomId === room.id ? 'active' : ''}`}
                  onClick={() => setSelectedRoomId(room.id)}
                >
                  <strong>{room.roomName}</strong>
                  <span>Room ID: {room.id}</span>
                  <span>Status: {room.status}</span>
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => onEnterRoom(room.id)}
                >
                  Enter Auction
                </button>
              </div>
            ))}
            {rooms.length === 0 ? <p>No rooms created yet.</p> : null}
          </div>
        </article>

        <article className="panel room-panel">
          <div className="panel-header">
            <h2>Selected room</h2>
            <span>{selectedRoom ? selectedRoom.roomName : 'No room selected'}</span>
          </div>

          {selectedRoom ? (
            <div className="room-sections">
              <div className="room-meta">
                <div>
                  <span className="label">Room ID</span>
                  <strong>{selectedRoom.id}</strong>
                </div>
                <div>
                  <span className="label">Participants</span>
                  <strong>{selectedRoom.participants.length}</strong>
                </div>
                <div>
                  <span className="label">Items</span>
                  <strong>{selectedRoom.items.length}</strong>
                </div>
              </div>

              <div className="room-actions">
                <form className="stack-form" onSubmit={handleAddParticipant}>
                  <h3>Add participant</h3>
                  <input
                    value={participantName}
                    onChange={(event) => setParticipantName(event.target.value)}
                    placeholder="Participant name"
                    required
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={participantPurse}
                    onChange={(event) => setParticipantPurse(event.target.value)}
                    placeholder="Purse amount"
                    required
                  />
                  <button type="submit">Add participant</button>
                </form>

                <form className="stack-form" onSubmit={handleAddItem}>
                  <h3>Add item</h3>
                  <input
                    value={itemName}
                    onChange={(event) => setItemName(event.target.value)}
                    placeholder="Item name"
                    required
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={itemPrice}
                    onChange={(event) => setItemPrice(event.target.value)}
                    placeholder="Base price"
                    required
                  />
                  <button type="submit">Add item</button>
                </form>
              </div>

              <div className="lists-grid">
                <section>
                  <h3>Participants list</h3>
                  <div className="info-list">
                    {selectedRoom.participants.map((participant) => (
                      <div key={participant.id} className="info-card">
                        <strong>{participant.name}</strong>
                        <span>ID: {participant.participantCode}</span>
                        <span>Purse: {participant.purseAmount}</span>
                      </div>
                    ))}
                    {selectedRoom.participants.length === 0 ? (
                      <p>No participants added yet.</p>
                    ) : null}
                  </div>
                </section>

                <section>
                  <h3>Items list</h3>
                  <div className="info-list">
                    {selectedRoom.items.map((item) => (
                      <div key={item.id} className="info-card">
                        <strong>{item.name}</strong>
                        <span>ID: {item.id}</span>
                        <span>Price: {item.price}</span>
                      </div>
                    ))}
                    {selectedRoom.items.length === 0 ? <p>No items added yet.</p> : null}
                  </div>
                </section>
              </div>
            </div>
          ) : (
            <p>Create a room, then click it to manage participants and items.</p>
          )}
        </article>
      </section>
    </main>
  );
}
