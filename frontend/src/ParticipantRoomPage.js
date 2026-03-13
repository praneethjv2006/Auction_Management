import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const HOST = window.location.hostname;
const API_BASE_URL = `http://${HOST}:4000/api`;
const SOCKET_URL = `http://${HOST}:4000`;

export default function ParticipantRoomPage({ participant, roomId, onBack }) {
  const [room, setRoom] = useState(null);
  const [presence, setPresence] = useState({ participants: [], organizers: [] });
  const [status, setStatus] = useState('Loading room...');
  const [bidError, setBidError] = useState('');
  const [showBoughtModal, setShowBoughtModal] = useState({ open: false, participant: null });
  const [showItemsModal, setShowItemsModal] = useState(false);
  const [itemFilter, setItemFilter] = useState('all');
  const [draggedItemId, setDraggedItemId] = useState(null);
  const [nowTs, setNowTs] = useState(Date.now());
  const socketRef = useRef(null);

  const activeParticipantIds = useMemo(
    () => new Set(presence.participants.map((entry) => entry.participantId)),
    [presence]
  );
  const activeOrganizer = presence.organizers.length > 0;

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
    const intervalId = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket'] });
    socketRef.current = socket;
    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    socket.on('connect', () => {
      socket.emit('joinRoom', {
        roomId,
        role: 'participant',
        participantId: participant.id,
        sessionId,
      });
    });

    socket.on('room:update', (updatedRoom) => {
      setRoom(updatedRoom);
    });

    socket.on('bid:error', (payload) => {
      if (payload?.message) setBidError(payload.message);
    });

    socket.on('order:error', (payload) => {
      if (payload?.message) setBidError(payload.message);
    });

    socket.on('presence:update', (payload) => {
      setPresence(payload);
    });

    return () => {
      socket.disconnect();
    };
  }, [roomId, participant.id]);

  function handleBid(event) {
    event.preventDefault();
    if (!socketRef.current) return;
    setBidError('');

    if (!currentItem) {
      setBidError('No active item to bid on');
      return;
    }

    if (currentItem.winnerId === participant.id) {
      return;
    }

    const currentBidBase = currentItem?.currentBid ?? currentItem?.price ?? 0;
    const nextBid = currentBidBase + 1;
    const remainingPurse = participantRecord
      ? participantRecord.remainingPurse
      : participant.remainingPurse;

    if (nextBid > remainingPurse) {
      setBidError('Bid exceeds remaining purse');
      return;
    }

    socketRef.current.emit('placeBid', {
      roomId,
      participantId: participant.id,
      amount: nextBid,
    });
  }

  function reorderOwnItems(targetIndex) {
    if (!room || !draggedItemId) return;

    const selfCard = room.participants.find((p) => p.id === participant.id);
    if (!selfCard) return;

    const currentItems = [...(selfCard.winningItems || [])];
    const currentIndex = currentItems.findIndex((item) => item.id === draggedItemId);
    if (currentIndex === -1) return;

    const [moved] = currentItems.splice(currentIndex, 1);
    currentItems.splice(targetIndex, 0, moved);
    const reorderedIds = currentItems.map((item) => item.id);

    setRoom((prevRoom) => {
      if (!prevRoom) return prevRoom;
      return {
        ...prevRoom,
        participants: prevRoom.participants.map((p) => (
          p.id === participant.id
            ? { ...p, winningItems: currentItems }
            : p
        )),
      };
    });

    socketRef.current?.emit('reorderBoughtItems', {
      roomId,
      participantId: participant.id,
      itemIds: reorderedIds,
    });

    setDraggedItemId(null);
  }

  if (status) return <div className="status-banner">{status}</div>;
  if (!room) return null;

  const currentItem = room.currentItem;
  const participantRecord = room.participants.find((p) => p.id === participant.id);
  const currentBidBase = currentItem?.currentBid ?? currentItem?.price ?? 0;
  const winnerName = currentItem?.winner
    ? currentItem.winner.name
    : currentItem?.winnerId
      ? room.participants.find((p) => p.id === currentItem.winnerId)?.name
      : null;
  const isLeading = currentItem?.winnerId === participant.id;
  const timerLeft = room.autoAuction?.enabled && room.autoAuction?.deadlineTs
    ? Math.max(0, Math.ceil((room.autoAuction.deadlineTs - nowTs) / 1000))
    : null;
  const filteredItems = room.items.filter((item) => itemFilter === 'all' || item.status === itemFilter);

  return (
    <div className="auction-room-page">
      <div className="auction-room-header">
        <button className="ghost-button" type="button" onClick={onBack}>
          &larr; Back to entry
        </button>
        <h2>Room {room.roomName}</h2>
        <button className="ghost-button" type="button" onClick={() => setShowItemsModal(true)}>
          View items
        </button>
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
          <div className={`presence-chip ${activeOrganizer ? 'active' : 'inactive'}`}>
            <span className="presence-dot" /> Organizer online
          </div>
          <div className="presence-chip">
            <span className="presence-dot" /> Participants online: {activeParticipantIds.size}
          </div>
        </div>
      </div>

      {room.status !== 'ended' ? (
        <>
          <div className="panel control-panel">
            <h3>Current item</h3>
            {currentItem ? (
              <div className="current-item highlight-card item-spotlight participant-spotlight">
                <p className="item-kicker">Live Bidding</p>
                <strong className="item-name">{currentItem.name}</strong>
                <span className="base-price-note">Base Price: {currentItem.price}</span>
                <div className="bid-strip">
                  <div className="item-stat-pill">
                    <span className="item-stat-label">Bid By</span>
                    <span className="item-stat-value">{winnerName || 'No bids yet'}</span>
                  </div>
                  <div className="item-stat-pill active-bid-pill">
                    <span className="item-stat-label">Current Bid</span>
                    <span className="item-stat-value">{currentBidBase}</span>
                  </div>
                  {!isLeading ? (
                    <button
                      type="button"
                      className="primary-bid-button"
                      onClick={(event) => handleBid(event)}
                      disabled={room.status !== 'live'}
                    >
                      Bid +1
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <p>Waiting for the organizer to select the next item.</p>
            )}

            <form className="stack-form" onSubmit={(event) => handleBid(event)}>
              {bidError ? <span className="status-banner">{bidError}</span> : null}
            </form>
          </div>

          <div className="panel">
            <h3>Your purse</h3>
            <p>Remaining: {participantRecord ? participantRecord.remainingPurse : participant.remainingPurse}</p>
          </div>

          <section>
            <h3>Participants</h3>
            <div className="info-list">
              {room.participants.map((p) => (
                <div key={p.id} className="info-card participant-card">
                  <div className="participant-card-top">
                    <div className="presence-row">
                      <span className={`presence-dot ${activeParticipantIds.has(p.id) ? 'active' : 'inactive'}`} />
                      <strong>{p.name}</strong>
                    </div>
                    <button
                      className="ghost-button participant-action"
                      onClick={() => setShowBoughtModal({ open: true, participant: p })}
                    >
                      Items bought
                    </button>
                  </div>
                  <span>Purse Remaining: {p.remainingPurse}</span>
                </div>
              ))}
              {room.participants.length === 0 && <p>No participants yet.</p>}
            </div>
          </section>
        </>
      ) : (
        <section className="panel">
          <h3>Final Results</h3>
          <div className="participant-grid">
            {room.participants.map((p) => {
              const isSelf = p.id === participant.id;
              return (
                <div key={p.id} className={`info-card participant-card ended-participant-card ${isSelf ? 'self-card' : ''}`}>
                  <div className="participant-card-top">
                    <strong>{p.name}</strong>
                    <span className="muted-text">Total: {(p.winningItems || []).length}</span>
                  </div>
                  <div className="bought-subcards">
                    {(p.winningItems || []).length ? (
                      p.winningItems.map((item, index) => (
                        <div
                          key={item.id}
                          className={`bought-subcard ${isSelf ? 'can-drag' : 'read-only'}`}
                          draggable={isSelf}
                          onDragStart={() => isSelf && setDraggedItemId(item.id)}
                          onDragOver={(event) => isSelf && event.preventDefault()}
                          onDrop={() => isSelf && reorderOwnItems(index)}
                        >
                          <strong>{item.name}</strong>
                          <span>Cost: {item.currentBid ?? item.price}</span>
                        </div>
                      ))
                    ) : (
                      <span className="muted-text">No items bought.</span>
                    )}
                  </div>
                  {isSelf ? <span className="muted-text">Drag your item cards to reorder.</span> : null}
                </div>
              );
            })}
          </div>
        </section>
      )}

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
    </div>
  );
}
