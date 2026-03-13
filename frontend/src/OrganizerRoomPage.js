import React, { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';

const API_BASE_URL = 'https://auction-management.onrender.com/api';
const SOCKET_URL = 'https://auction-management.onrender.com';

export default function OrganizerRoomPage({ roomId, organizer, onBack }) {
  const [room, setRoom] = useState(null);
  const [presence, setPresence] = useState({ participants: [], organizers: [] });
  const [status, setStatus] = useState('Loading room...');
  const [showSelectModal, setShowSelectModal] = useState(false);
  const [showBoughtModal, setShowBoughtModal] = useState({ open: false, participant: null });
  const [showAutoModal, setShowAutoModal] = useState(false);
  const [showItemsModal, setShowItemsModal] = useState(false);
  const [itemFilter, setItemFilter] = useState('all');
  const [autoBidWindow, setAutoBidWindow] = useState('15');
  const [boughtOrderByParticipant, setBoughtOrderByParticipant] = useState({});
  const [nowTs, setNowTs] = useState(Date.now());

  const activeParticipantIds = useMemo(
    () => new Set(presence.participants.map((entry) => entry.participantId)),
    [presence]
  );

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

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket'] });
    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    socket.on('connect', () => {
      socket.emit('joinRoom', {
        roomId,
        role: 'organizer',
        organizerId: organizer.id,
        sessionId,
      });
    });

    socket.on('room:update', (updatedRoom) => {
      setRoom(updatedRoom);
    });

    socket.on('presence:update', (payload) => {
      setPresence(payload);
    });

    return () => {
      socket.disconnect();
    };
  }, [roomId, organizer.id]);

  useEffect(() => {
    const intervalId = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!room || room.status !== 'ended') return;

    setBoughtOrderByParticipant((prev) => {
      const next = { ...prev };
      for (const participant of room.participants) {
        if (!next[participant.id] || next[participant.id].length === 0) {
          next[participant.id] = participant.winningItems.map((item) => item.id);
        }
      }
      return next;
    });
  }, [room]);

  async function handleControl(endpoint, payload) {
    try {
      const res = await fetch(`${API_BASE_URL}/rooms/${roomId}/${endpoint}`, {
        method: 'POST',
        headers: payload ? { 'Content-Type': 'application/json' } : undefined,
        body: payload ? JSON.stringify(payload) : undefined,
      });
      const contentType = res.headers.get('content-type') || '';
      let data = null;
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        data = { error: text ? text.slice(0, 160) : res.statusText };
      }
      if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
      setRoom(data);
    } catch (error) {
      setStatus(error.message);
    }
  }

  function getOrderedBoughtItems(participant) {
    const baseItems = participant.winningItems || [];
    const configuredOrder = boughtOrderByParticipant[participant.id] || [];
    if (!configuredOrder.length) return baseItems;

    const byId = new Map(baseItems.map((item) => [item.id, item]));
    const ordered = configuredOrder.map((id) => byId.get(id)).filter(Boolean);
    const missing = baseItems.filter((item) => !configuredOrder.includes(item.id));
    return [...ordered, ...missing];
  }

  if (status) return <div className="status-banner">{status}</div>;
  if (!room) return null;

  const currentItem = room.currentItem;
  const winnerName = currentItem?.winner
    ? currentItem.winner.name
    : currentItem?.winnerId
      ? room.participants.find((p) => p.id === currentItem.winnerId)?.name
      : null;

  const upcomingItems = room.items.filter((item) => item.status === 'upcoming');
  const currentBid = currentItem?.currentBid ?? currentItem?.price ?? 0;
  const timerLeft = room.autoAuction?.enabled && room.autoAuction?.deadlineTs
    ? Math.max(0, Math.ceil((room.autoAuction.deadlineTs - nowTs) / 1000))
    : null;
  const filteredItems = room.items.filter((item) => itemFilter === 'all' || item.status === itemFilter);

  return (
    <div className="auction-room-page">
      <div className="auction-room-header">
        <button className="ghost-button" type="button" onClick={onBack}>
          &larr; Back to dashboard
        </button>
        <h2>Auction Room: {room.roomName}</h2>
        <div className="header-actions">
          <button className="ghost-button" type="button" onClick={() => setShowItemsModal(true)}>
            View items
          </button>
          <button
            className="ghost-button danger-button"
            type="button"
            onClick={() => handleControl('end')}
            disabled={room.status !== 'live'}
          >
            End Auction
          </button>
        </div>
      </div>

      <div className="timer-banner">
        <strong>Auction Timer</strong>
        {room.autoAuction?.enabled ? (
          <span>{timerLeft != null ? `${timerLeft}s` : '--'}</span>
        ) : (
          <span>Automatic timer is off</span>
        )}
      </div>

      <div className="room-meta">
        <span>Room ID: {room.id}</span>
        <span>Status: {room.status}</span>
        <div className="presence-bar">
          <div className={`presence-chip ${presence.organizers.length ? 'active' : 'inactive'}`}>
            <span className="presence-dot" /> Organizer online
          </div>
          <div className="presence-chip">
            <span className="presence-dot" /> Participants online: {activeParticipantIds.size}
          </div>
        </div>
      </div>

      <div className="panel control-panel">
        <h3>Live auction</h3>
        <div className="control-buttons">
          {room.status !== 'live' ? (
            <button type="button" onClick={() => handleControl('start')}>
              Start Auction
            </button>
          ) : null}
          {currentItem ? (
            <button type="button" onClick={() => handleControl('stop-item')}>
              Stop Current Item
            </button>
          ) : null}
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              if (room.autoAuction?.enabled) {
                handleControl('auto', { enabled: false });
              } else {
                setShowAutoModal(true);
              }
            }}
          >
            {room.autoAuction?.enabled ? 'Disable Automatic Auction' : 'Enable Automatic Auction'}
          </button>
        </div>

        {room.autoAuction?.enabled ? (
          <p className="muted-text">
            Automatic mode ON: {room.autoAuction.bidWindowSeconds}s reset timer
            {room.autoAuction.timeLeftSeconds != null ? ` (${room.autoAuction.timeLeftSeconds}s left)` : ''}
          </p>
        ) : null}

        {currentItem ? (
          <div className="current-item highlight-card item-spotlight">
            <p className="item-kicker">Current Item</p>
            <strong className="item-name">{currentItem.name}</strong>
            <div className="item-stats">
              <div className="item-stat-pill">
                <span className="item-stat-label">Current Bid</span>
                <span className="item-stat-value">{currentBid}</span>
              </div>
              <div className="item-stat-pill">
                <span className="item-stat-label">Latest Bid By</span>
                <span className="item-stat-value">{winnerName || 'No bids yet'}</span>
              </div>
              <div className="item-stat-pill">
                <span className="item-stat-label">Base Price</span>
                <span className="item-stat-value">{currentItem.price}</span>
              </div>
            </div>
          </div>
        ) : (
          <p>Waiting for next item. Select an upcoming item to begin bidding.</p>
        )}

        {/* Select next item button and modal */}
        {!currentItem && room.status === 'live' && upcomingItems.length > 0 && (
          <button
            type="button"
            className="ghost-button"
            style={{ marginTop: 16 }}
            onClick={() => setShowSelectModal(true)}
          >
            Select next item
          </button>
        )}
        {showSelectModal && (
          <div className="modal-overlay">
            <div className="modal-content">
              <h3>Select Next Item</h3>
              <div className="info-list">
                {upcomingItems.map((item) => (
                  <div key={item.id} className="info-card">
                    <strong>{item.name}</strong>
                    <span>Price: {item.price}</span>
                    <button
                      type="button"
                      onClick={() => {
                        handleControl('select-item', { itemId: item.id });
                        setShowSelectModal(false);
                      }}
                    >
                      Select
                    </button>
                  </div>
                ))}
              </div>
              <button className="ghost-button" onClick={() => setShowSelectModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <section>
        <h3>Participants</h3>
        <div className="info-list">
          {room.participants.map((participant) => (
            <div key={participant.id} className="info-card participant-card">
              <div className="participant-card-top">
                <div className="presence-row">
                  <span
                    className={`presence-dot ${activeParticipantIds.has(participant.id) ? 'active' : 'inactive'}`}
                  />
                  <strong>{participant.name}</strong>
                </div>
                <button
                  className="ghost-button participant-action"
                  onClick={() => setShowBoughtModal({ open: true, participant })}
                >
                  Items bought
                </button>
              </div>
              <span>ID: {participant.participantCode}</span>
              <span>Purse Remaining: {participant.remainingPurse}</span>
            </div>
          ))}
          {room.participants.length === 0 && <p>No participants yet.</p>}
        </div>
      </section>

      {/* Items bought modal */}
      {showBoughtModal.open && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>Items bought by {showBoughtModal.participant.name}</h3>
            <div className="info-list">
              {showBoughtModal.participant.winningItems && showBoughtModal.participant.winningItems.length > 0 ? (
                showBoughtModal.participant.winningItems.map((item) => (
                  <div key={item.id} className="info-card">
                    <strong>{item.name}</strong>
                    <span>Cost: {item.currentBid ?? item.price}</span>
                  </div>
                ))
              ) : (
                <p>No items bought.</p>
              )}
            </div>
            <button className="ghost-button" onClick={() => setShowBoughtModal({ open: false, participant: null })}>
              Close
            </button>
          </div>
        </div>
      )}

      {showAutoModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>Enable Automatic Auction</h3>
            <p className="muted-text">
              Set a timer for each item. If nobody bids in that time, the item closes as sold to latest bidder or unsold.
              On every new bid, timer restarts. Next item is selected randomly from upcoming items.
            </p>
            <label className="label" htmlFor="autoBidWindow">Timer per item (seconds)</label>
            <input
              id="autoBidWindow"
              type="number"
              min="3"
              step="1"
              value={autoBidWindow}
              onChange={(event) => setAutoBidWindow(event.target.value)}
            />
            <div className="control-buttons">
              <button
                type="button"
                onClick={async () => {
                  await handleControl('auto', {
                    enabled: true,
                    bidWindowSeconds: Number(autoBidWindow),
                  });
                  setShowAutoModal(false);
                }}
              >
                Confirm Automatic Mode
              </button>
              <button className="ghost-button" type="button" onClick={() => setShowAutoModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showItemsModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>View Items</h3>
            <div className="item-filter-row">
              <button type="button" className={`ghost-button ${itemFilter === 'all' ? 'filter-active' : ''}`} onClick={() => setItemFilter('all')}>All</button>
              <button type="button" className={`ghost-button ${itemFilter === 'upcoming' ? 'filter-active' : ''}`} onClick={() => setItemFilter('upcoming')}>Upcoming</button>
              <button type="button" className={`ghost-button ${itemFilter === 'ongoing' ? 'filter-active' : ''}`} onClick={() => setItemFilter('ongoing')}>Ongoing</button>
              <button type="button" className={`ghost-button ${itemFilter === 'sold' ? 'filter-active' : ''}`} onClick={() => setItemFilter('sold')}>Sold</button>
              <button type="button" className={`ghost-button ${itemFilter === 'unsold' ? 'filter-active' : ''}`} onClick={() => setItemFilter('unsold')}>Unsold</button>
            </div>
            <div className="info-list">
              {filteredItems.length ? (
                filteredItems.map((item) => (
                  <div key={item.id} className="info-card">
                    <strong>{item.name}</strong>
                    <span>Status: {item.status}</span>
                    <span>Base Price: {item.price}</span>
                    <span>Final: {item.currentBid ?? item.price}</span>
                  </div>
                ))
              ) : (
                <p>No items in this category.</p>
              )}
            </div>
            <button className="ghost-button" type="button" onClick={() => setShowItemsModal(false)}>Close</button>
          </div>
        </div>
      )}

      {room.status === 'ended' ? (
        <section className="panel">
          <h3>Auction Result: Items Bought by Participants</h3>
          <div className="participant-grid">
            {room.participants.map((participant) => {
              const orderedItems = getOrderedBoughtItems(participant);

              return (
                <div key={participant.id} className="info-card participant-card ended-participant-card">
                  <div className="participant-card-top">
                    <strong>{participant.name}</strong>
                    <span className="muted-text">Total: {orderedItems.length}</span>
                  </div>
                  <div className="bought-subcards">
                    {orderedItems.length ? (
                      orderedItems.map((item, index) => (
                        <div
                          key={item.id}
                          className="bought-subcard"
                        >
                          <strong>{item.name}</strong>
                          <span>Cost: {item.currentBid ?? item.price}</span>
                        </div>
                      ))
                    ) : (
                      <span className="muted-text">No items bought.</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
