import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { getSocketUrl, requestJson } from './network';

const SOCKET_URL = getSocketUrl();

export default function ParticipantRoomPage({ participant, roomId, onBack, onLogout }) {
  const [room, setRoom] = useState(null);
  const [presence, setPresence] = useState({ participants: [], organizers: [] });
  const [status, setStatus] = useState('Loading room...');
  const [bidError, setBidError] = useState('');
  const [showBoughtModal, setShowBoughtModal] = useState({ open: false, participant: null });
  const [showItemsModal, setShowItemsModal] = useState(false);
  const [itemFilter, setItemFilter] = useState('all');
  const [itemCategoryFilter, setItemCategoryFilter] = useState('all');
  const [itemNameSearch, setItemNameSearch] = useState('');
  const [draggedItemId, setDraggedItemId] = useState(null);
  const [captainItemId, setCaptainItemId] = useState(null);
  const [wicketKeeperItemId, setWicketKeeperItemId] = useState(null);
  const [showRolePicker, setShowRolePicker] = useState(false);
  const [draftCaptainItemId, setDraftCaptainItemId] = useState(null);
  const [draftWicketKeeperItemId, setDraftWicketKeeperItemId] = useState(null);
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
        const data = await requestJson(`/rooms/${roomId}`);
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

    socket.on('skip:error', (payload) => {
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

    const skipState = room?.skipState;
    const participantSkipped = skipState
      && skipState.itemId === currentItem.id
      && Array.isArray(skipState.participantIds)
      && skipState.participantIds.includes(participant.id);

    if (participantSkipped) {
      setBidError('You skipped this item and cannot bid anymore.');
      return;
    }

    const currentBidBase = currentItem?.currentBid ?? currentItem?.price ?? 0;
    const bidBaseNumber = Number(currentBidBase) || 0;

    let increment = 1;
    if (bidBaseNumber < 1) increment = 0.2;
    else if (bidBaseNumber < 2) increment = 0.25;
    else if (bidBaseNumber < 5) increment = 0.5;
    else if (bidBaseNumber <= 10) increment = 1;
    else increment = 1.5;

    const nextBid = Number((bidBaseNumber + increment).toFixed(2));
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

  if (!room) return status ? <div className="status-banner">{status}</div> : null;

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
  const itemCategories = room.categories?.length
    ? room.categories.map((entry) => entry.name)
    : Array.from(new Set(room.items.map((item) => item.category || 'General')));
  const filteredItems = room.items.filter((item) => {
    const statusMatch = itemFilter === 'all' || item.status === itemFilter;
    const categoryMatch = itemCategoryFilter === 'all' || (item.category || 'General') === itemCategoryFilter;
    const nameMatch = !itemNameSearch.trim() || String(item.name || '').toLowerCase().includes(itemNameSearch.trim().toLowerCase());
    return statusMatch && categoryMatch && nameMatch;
  });
  const participantSkippedCurrentItem = !!(
    currentItem
    && room.skipState
    && room.skipState.itemId === currentItem.id
    && Array.isArray(room.skipState.participantIds)
    && room.skipState.participantIds.includes(participant.id)
  );

  return (
    <div className="auction-room-page">
      <div className="auction-room-header">
        <button className="ghost-button" type="button" onClick={onBack}>
          &larr; Back to entry
        </button>
        <h2>Room {room.roomName}</h2>
        <div className="header-actions">
          <button className="ghost-button" type="button" onClick={() => setShowItemsModal(true)}>
            View items
          </button>
          <button className="ghost-button" type="button" onClick={onLogout}>
            Log out
          </button>
        </div>
      </div>

      {status ? <div className="status-banner">{status}</div> : null}

      <div className="participant-meta-strip">
        <span className="participant-room-id">Room ID: {room.id}</span>
        <div className="participant-highlight-name-block">
          <div className="participant-name-card">
            <span className="participant-highlight-name">{participant.name}</span>
          </div>
          {room.status !== 'ended' && currentItem && !participantSkippedCurrentItem ? (
            <div className="participant-current-category-highlight">
              {currentItem.category || 'General'}
            </div>
          ) : null}
        </div>
      </div>

      <div className="presence-bar">
        <div className={`presence-chip ${activeOrganizer ? 'active' : 'inactive'}`}>
          <span className="presence-dot" /> Organizer online
        </div>
        <div className="presence-chip">
          <span className="presence-dot" /> Participants online: {activeParticipantIds.size}
        </div>
      </div>

      {room.status !== 'ended' ? (
        <>
          <div className="panel control-panel">
            <h3>Current item</h3>
            {currentItem ? (
              <div className="current-item highlight-card item-spotlight participant-spotlight pro-current-item">
                {room.autoAuction?.enabled && timerLeft != null ? (
                  <span
                    key={timerLeft}
                    className={`auction-timer-pill timer-auction-tick ${
                      timerLeft <= 5
                        ? 'timer-critical'
                        : timerLeft > 10
                          ? 'timer-safe'
                          : ''
                    }`}
                  >
                    {timerLeft}
                  </span>
                ) : (
                  <span className="auction-timer-pill">--</span>
                )}
                <p className="item-kicker">Live Bidding</p>
                <strong className="item-name">{currentItem.name}</strong>
                <span className="item-category-badge">{currentItem.category || 'General'}</span>
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
                      disabled={room.status !== 'live' || participantSkippedCurrentItem}
                    >
                      Bid
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      setBidError('');
                      socketRef.current?.emit('participantSkipItem', {
                        roomId,
                        participantId: participant.id,
                      });
                    }}
                    disabled={room.status !== 'live' || participantSkippedCurrentItem}
                  >
                    {participantSkippedCurrentItem ? 'Skipped' : 'Skip Item'}
                  </button>
                </div>
              </div>
            ) : (
              <p>Waiting for the organizer to select the next item.</p>
            )}

            {room.skipState?.participantNames?.length ? (
              <div className="status-banner skip-banner">
                <strong>Skipped:</strong> {room.skipState.participantNames.join(', ')}
              </div>
            ) : null}

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
          <h3 className="results-title">Final Results</h3>
          <div className="participant-grid">
            {room.participants.map((p, teamIndex) => {
              const isSelf = p.id === participant.id;
              const winningItems = p.winningItems || [];
              const mainItems = winningItems.slice(0, 11);
              const substituteItems = winningItems.slice(11);
              return (
                <div
                  key={p.id}
                  className={`info-card participant-card ended-participant-card team-variant-${teamIndex % 5} ${isSelf ? 'self-card' : ''}`}
                >
                  <div className="results-card-header">
                    <strong className="results-team-name">{p.name}</strong>
                    <span className="muted-text">Total: {(p.winningItems || []).length}</span>
                  </div>
                  {winningItems.length ? (
                    <>
                      <div className="results-team-section">
                        <div className="results-team-header">
                          <span className="muted-text">Main (11)</span>
                        </div>
                        <div className="bought-subcards">
                          {mainItems.map((item, index) => (
                            <div
                              key={item.id}
                              className={`bought-subcard ${isSelf ? 'can-drag' : 'read-only'}`}
                              draggable={isSelf}
                              onDragStart={() => isSelf && setDraggedItemId(item.id)}
                              onDragOver={(event) => isSelf && event.preventDefault()}
                              onDrop={() => isSelf && reorderOwnItems(index)}
                            >
                              <div className="bought-subcard-content">
                                <strong>{item.name}</strong>
                                <span className="item-category-badge">{item.category || 'General'}</span>
                              </div>
                              {isSelf && captainItemId === item.id ? <span className="captain-badge">C</span> : null}
                              {isSelf && wicketKeeperItemId === item.id ? <span className="wk-badge">WK</span> : null}
                            </div>
                          ))}
                          {isSelf && mainItems.length < 11 ? (
                            <div
                              className="results-dropzone"
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={() => reorderOwnItems(mainItems.length)}
                            >
                              Drop here to add into Main
                            </div>
                          ) : null}
                          {mainItems.length < 11 ? (
                            <div className="results-empty-note muted-text">
                              Slots remaining: {11 - mainItems.length}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="results-team-section">
                        <div className="results-team-header">
                          <span className="muted-text">Substitutes</span>
                        </div>
                        <div className="bought-subcards">
                          {substituteItems.length ? (
                            substituteItems.map((item, index) => {
                              const absoluteIndex = 11 + index;
                              return (
                                <div
                                  key={item.id}
                                  className={`bought-subcard ${isSelf ? 'can-drag' : 'read-only'}`}
                                  draggable={isSelf}
                                  onDragStart={() => isSelf && setDraggedItemId(item.id)}
                                  onDragOver={(event) => isSelf && event.preventDefault()}
                                  onDrop={() => isSelf && reorderOwnItems(absoluteIndex)}
                                >
                                  <div className="bought-subcard-content">
                                    <strong>{item.name}</strong>
                                    <span className="item-category-badge">{item.category || 'General'}</span>
                                  </div>
                                  {isSelf && captainItemId === item.id ? <span className="captain-badge">C</span> : null}
                                  {isSelf && wicketKeeperItemId === item.id ? <span className="wk-badge">WK</span> : null}
                                </div>
                              );
                            })
                          ) : (
                            <span className="muted-text">No substitutes.</span>
                          )}
                        </div>

                        {isSelf ? (
                          <div className="results-role-box">
                            <button
                              type="button"
                              className="ghost-button"
                              onClick={() => {
                                setDraftCaptainItemId(captainItemId);
                                setDraftWicketKeeperItemId(wicketKeeperItemId);
                                setShowRolePicker(true);
                              }}
                            >
                              Select Captain & Wicket Keeper
                            </button>

                            {showRolePicker ? (
                              <>
                                <div className="results-role-controls">
                                  <select
                                    className="filter-select"
                                    value={draftCaptainItemId ? String(draftCaptainItemId) : ''}
                                    onChange={(event) => setDraftCaptainItemId(event.target.value ? Number(event.target.value) : null)}
                                  >
                                    <option value="">Captain</option>
                                    {winningItems.map((item) => (
                                      <option key={item.id} value={String(item.id)}>
                                        {item.name}
                                      </option>
                                    ))}
                                  </select>
                                  <select
                                    className="filter-select"
                                    value={draftWicketKeeperItemId ? String(draftWicketKeeperItemId) : ''}
                                    onChange={(event) => setDraftWicketKeeperItemId(event.target.value ? Number(event.target.value) : null)}
                                  >
                                    <option value="">Wicket Keeper</option>
                                    {winningItems.map((item) => (
                                      <option key={item.id} value={String(item.id)}>
                                        {item.name}
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                <div className="control-buttons" style={{ marginTop: 10 }}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setCaptainItemId(draftCaptainItemId);
                                      setWicketKeeperItemId(draftWicketKeeperItemId);
                                      setShowRolePicker(false);
                                    }}
                                  >
                                    Save Changes
                                  </button>
                                  <button
                                    type="button"
                                    className="ghost-button"
                                    onClick={() => {
                                      setDraftCaptainItemId(captainItemId);
                                      setDraftWicketKeeperItemId(wicketKeeperItemId);
                                      setShowRolePicker(false);
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </>
                            ) : null}
                          </div>
                        ) : null}
                      </div>

                      {isSelf ? <span className="muted-text">Drag cards between Main and Substitutes.</span> : null}
                    </>
                  ) : (
                    <span className="muted-text">No items bought.</span>
                  )}
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
                    <span className="item-category-badge">{item.category || 'General'}</span>
                    {showBoughtModal.participant.id === participant.id && captainItemId === item.id ? (
                      <span className="captain-badge">C</span>
                    ) : null}
                    {showBoughtModal.participant.id === participant.id && wicketKeeperItemId === item.id ? (
                      <span className="wk-badge">WK</span>
                    ) : null}
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
            <button className="modal-close-button" type="button" onClick={() => setShowItemsModal(false)}>
              &times;
            </button>
            <h3>View Items</h3>
            <div className="item-filter-row">
              <input
                value={itemNameSearch}
                onChange={(event) => setItemNameSearch(event.target.value)}
                placeholder="Search by name"
              />
              <select
                className="filter-select"
                value={itemFilter}
                onChange={(event) => setItemFilter(event.target.value)}
              >
                <option value="all">All Status</option>
                <option value="upcoming">Upcoming</option>
                <option value="ongoing">Ongoing</option>
                <option value="sold">Sold</option>
                <option value="unsold">Unsold</option>
              </select>
              <select
                className="filter-select"
                value={itemCategoryFilter}
                onChange={(event) => setItemCategoryFilter(event.target.value)}
              >
                <option value="all">All Categories</option>
                {itemCategories.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </div>
            <div className="info-list">
              {filteredItems.length ? (
                filteredItems.map((item) => (
                  <div key={item.id} className="info-card">
                    <strong>{item.name}</strong>
                    <span className="item-category-badge">{item.category || 'General'}</span>
                    <span>Status: {item.status}</span>
                    <span>Base Price: {item.price}</span>
                    <span>Final: {item.currentBid ?? item.price}</span>
                  </div>
                ))
              ) : (
                <p>No items in this category.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
