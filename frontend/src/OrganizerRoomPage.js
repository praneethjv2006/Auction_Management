import React, { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { getSocketUrl, requestJson } from './network';

const SOCKET_URL = getSocketUrl();

export default function OrganizerRoomPage({ roomId, organizer, onBack }) {
  const [room, setRoom] = useState(null);
  const [presence, setPresence] = useState({ participants: [], organizers: [] });
  const [status, setStatus] = useState('Loading room...');
  const [showSelectModal, setShowSelectModal] = useState(false);
  const [showBoughtModal, setShowBoughtModal] = useState({ open: false, participant: null });
  const [showAutoModal, setShowAutoModal] = useState(false);
  const [showItemsModal, setShowItemsModal] = useState(false);
  const [showRestartModal, setShowRestartModal] = useState(false);
  const [itemFilter, setItemFilter] = useState('all');
  const [itemCategoryFilter, setItemCategoryFilter] = useState('all');
  const [itemNameSearch, setItemNameSearch] = useState('');
  const [autoBidWindow, setAutoBidWindow] = useState('15');
  const [boughtOrderByParticipant, setBoughtOrderByParticipant] = useState({});
  const [restartMode, setRestartMode] = useState('same');
  const [samePurseAmount, setSamePurseAmount] = useState('100');
  const [individualPurses, setIndividualPurses] = useState({});
  const [editingParticipantId, setEditingParticipantId] = useState(null);
  const [editingParticipantPurse, setEditingParticipantPurse] = useState('');
  const [showItemEditModal, setShowItemEditModal] = useState(false);
  const [editingItemId, setEditingItemId] = useState(null);
  const [editingItemName, setEditingItemName] = useState('');
  const [editingItemPrice, setEditingItemPrice] = useState('');
  const [editingItemCategory, setEditingItemCategory] = useState('');
  const [nowTs, setNowTs] = useState(Date.now());
  const [captainByParticipantId, setCaptainByParticipantId] = useState({});

  const activeParticipantIds = useMemo(
    () => new Set(presence.participants.map((entry) => entry.participantId)),
    [presence]
  );

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

  useEffect(() => {
    if (!room) return;

    setIndividualPurses((prev) => {
      const next = { ...prev };
      for (const participant of room.participants) {
        if (next[participant.id] == null) {
          next[participant.id] = String(participant.purseAmount ?? participant.remainingPurse ?? 0);
        }
      }
      return next;
    });
  }, [room]);

  async function handleControl(endpoint, payload, method = 'POST') {
    try {
      const data = await requestJson(`/rooms/${roomId}/${endpoint}`, {
        method,
        headers: payload ? { 'Content-Type': 'application/json' } : undefined,
        body: payload ? JSON.stringify(payload) : undefined,
      });
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

  if (!room) return status ? <div className="status-banner">{status}</div> : null;

  async function handleRestartAuction() {
    const payload = restartMode === 'individual'
      ? {
          mode: 'individual',
          participantPurses: room.participants.map((participant) => ({
            participantId: participant.id,
            purseAmount: Number(individualPurses[participant.id]),
          })),
        }
      : {
          mode: 'same',
          purseAmount: Number(samePurseAmount),
        };

    await handleControl('restart', payload);
    setShowSelectModal(false);
    setShowBoughtModal({ open: false, participant: null });
    setShowItemsModal(false);
    setItemFilter('upcoming');
    setItemCategoryFilter('all');
    setShowRestartModal(false);
    setStatus('Auction restarted successfully. All items reset to upcoming.');
  }

  async function handleParticipantPurseSave(participantId) {
    const purseAmount = Number(editingParticipantPurse);
    if (Number.isNaN(purseAmount) || purseAmount < 0) {
      setStatus('Please enter a valid purse amount.');
      return;
    }

    try {
      await handleControl(`participants/${participantId}`, { purseAmount }, 'PATCH');
      setStatus('Participant purse updated.');
      setEditingParticipantId(null);
      setEditingParticipantPurse('');
    } catch (error) {
      setStatus(error.message);
    }
  }

  function openItemEdit(item) {
    setEditingItemId(item.id);
    setEditingItemName(item.name || '');
    setEditingItemPrice(String(item.price ?? ''));
    setEditingItemCategory(item.category || 'General');
    setShowItemsModal(false);
    setShowSelectModal(false);
    setShowBoughtModal({ open: false, participant: null });
    setShowItemEditModal(true);
  }

  async function handleItemEditSave() {
    if (!editingItemId) return;

    try {
      const updatedRoom = await requestJson(`/rooms/${roomId}/items/${editingItemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editingItemName,
          price: editingItemPrice,
          category: editingItemCategory,
        }),
      });
      setRoom(updatedRoom);
      setStatus('Item updated successfully.');
      setShowItemEditModal(false);
      setEditingItemId(null);
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function handleDeleteRoom() {
    const confirmed = window.confirm(`Delete room "${room.roomName}"? This removes all items and participants.`);
    if (!confirmed) return;

    try {
      await requestJson(`/rooms/${roomId}`, { method: 'DELETE' });
      onBack();
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function handleDeleteItem(itemId) {
    const item = room.items.find((entry) => entry.id === itemId);
    if (!item) return;

    const confirmed = window.confirm(`Delete item "${item.name}"? This cannot be undone.`);
    if (!confirmed) return;

    try {
      const updatedRoom = await requestJson(`/rooms/${roomId}/items/${itemId}`, { method: 'DELETE' });
      setRoom(updatedRoom);
      setStatus('Item deleted.');
    } catch (error) {
      setStatus(error.message);
    }
  }

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
  const itemCategories = room.categories?.length
    ? room.categories.map((entry) => entry.name)
    : Array.from(new Set(room.items.map((item) => item.category || 'General')));
  const editCategoryOptions = room.categories?.length
    ? room.categories.map((entry) => entry.name)
    : itemCategories;
  const filteredItems = room.items.filter((item) => {
    const statusMatch = itemFilter === 'all' || item.status === itemFilter;
    const categoryMatch = itemCategoryFilter === 'all' || (item.category || 'General') === itemCategoryFilter;
    const nameMatch = !itemNameSearch.trim() || String(item.name || '').toLowerCase().includes(itemNameSearch.trim().toLowerCase());
    return statusMatch && categoryMatch && nameMatch;
  });

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
          <button className="ghost-button danger-button" type="button" onClick={handleDeleteRoom}>
            Delete Room
          </button>
          <button className="ghost-button" type="button" onClick={() => setShowRestartModal(true)}>
            Restart Auction
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

      {status ? <div className="status-banner">{status}</div> : null}

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
            onClick={() => handleControl('previous')}
            disabled={!!currentItem}
          >
            Previous Item
          </button>
          {currentItem ? (
            <button type="button" className="ghost-button" onClick={() => handleControl('skip')}>
              Skip Item (Organizer)
            </button>
          ) : null}
          {room.autoAuction?.enabled ? (
            <>
              <button
                type="button"
                className="ghost-button"
                onClick={async () => {
                  await handleControl('auto', { enabled: false });
                  setStatus('Automatic auction paused.');
                }}
              >
                Pause Automatic Auction
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={async () => {
                  await handleControl('auto', { enabled: false });
                  setStatus('Switched to manual auction mode.');
                }}
              >
                Switch To Manual Auction
              </button>
            </>
          ) : (
            <button type="button" className="ghost-button" onClick={() => setShowAutoModal(true)}>
              Enable Automatic Auction
            </button>
          )}
        </div>

        {room.autoAuction?.enabled ? (
          <p className="muted-text">
            Automatic mode ON: {room.autoAuction.bidWindowSeconds}s reset timer
            {room.autoAuction.timeLeftSeconds != null ? ` (${room.autoAuction.timeLeftSeconds}s left)` : ''}
          </p>
        ) : null}

        {room.skipState?.participantNames?.length ? (
          <div className="status-banner">
            Skipped by: {room.skipState.participantNames.join(', ')}
          </div>
        ) : null}

        {currentItem ? (
          <div className="current-item highlight-card item-spotlight pro-current-item">
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
            <p className="item-kicker">Current Item</p>
            <strong className="item-name">{currentItem.name}</strong>
            <span className="item-category-badge">{currentItem.category || 'General'}</span>
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
        {!room.autoAuction?.enabled && !currentItem && room.status === 'live' && upcomingItems.length > 0 && (
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
                  <div key={item.id} className="info-card item-card">
                    <strong>{item.name}</strong>
                    <span className="item-category-badge">{item.category || 'General'}</span>
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
                    <button
                      type="button"
                      className="item-edit-icon"
                      onClick={() => openItemEdit(item)}
                    >
                      &#9998;
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
              <div className="participant-balance-row">
                <span>Purse Remaining: {participant.remainingPurse} cr</span>
                {editingParticipantId !== participant.id ? (
                  <button
                    type="button"
                    className="pencil-button"
                    onClick={() => {
                      setEditingParticipantId(participant.id);
                      setEditingParticipantPurse(String(participant.purseAmount ?? participant.remainingPurse ?? 0));
                    }}
                    aria-label="Edit purse"
                    title="Edit purse"
                  >
                    &#9998;
                  </button>
                ) : null}
              </div>

              {editingParticipantId === participant.id ? (
                <div className="item-filter-row">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editingParticipantPurse}
                    onChange={(event) => setEditingParticipantPurse(event.target.value)}
                    placeholder="Purse amount"
                  />
                  <button type="button" onClick={() => handleParticipantPurseSave(participant.id)}>
                    Save
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      setEditingParticipantId(null);
                      setEditingParticipantPurse('');
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : null}
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
                  <div key={item.id} className="info-card item-card">
                    <strong>{item.name}</strong>
                    <span>Cost: {item.currentBid ?? item.price}</span>
                    <button
                      type="button"
                      className="item-edit-icon"
                      onClick={() => openItemEdit(item)}
                    >
                      &#9998;
                    </button>
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
                  <div key={item.id} className="info-card item-card">
                    <strong>{item.name}</strong>
                    <span className="item-category-badge">{item.category || 'General'}</span>
                    <span>Status: {item.status}</span>
                    <span>Base Price: {item.price}</span>
                    <span>Final: {item.currentBid ?? item.price}</span>
                    <div className="item-filter-row">
                      <button
                        type="button"
                        className="ghost-button danger-button"
                        onClick={() => handleDeleteItem(item.id)}
                      >
                        Delete
                      </button>
                    </div>
                    <button
                      type="button"
                      className="item-edit-icon"
                      onClick={() => openItemEdit(item)}
                    >
                      &#9998;
                    </button>
                  </div>
                ))
              ) : (
                <p>No items in this category.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {showItemEditModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <button
              className="modal-close-button"
              type="button"
              onClick={() => {
                setShowItemEditModal(false);
                setEditingItemId(null);
              }}
            >
              &times;
            </button>
            <h3>Edit Item</h3>
            <div className="stack-form">
              <input
                value={editingItemName}
                onChange={(event) => setEditingItemName(event.target.value)}
                placeholder="Item name"
                required
              />
              <input
                type="number"
                min="0"
                step="0.01"
                value={editingItemPrice}
                onChange={(event) => setEditingItemPrice(event.target.value)}
                placeholder="Price"
                required
              />
              <select
                value={editingItemCategory}
                onChange={(event) => setEditingItemCategory(event.target.value)}
                required
              >
                {editCategoryOptions.length === 0 ? (
                  <option value="General">General</option>
                ) : (
                  editCategoryOptions.map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))
                )}
              </select>
            </div>
            <div className="control-buttons">
              <button type="button" onClick={handleItemEditSave}>Save Changes</button>
              <button className="ghost-button" type="button" onClick={() => setShowItemEditModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showRestartModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>Restart Auction</h3>
            <p className="muted-text">
              Restarting resets all items to upcoming, removes winners from items, clears bids, and asks for purse setup.
            </p>

            <div className="item-filter-row">
              <button
                type="button"
                className={`ghost-button ${restartMode === 'same' ? 'filter-active' : ''}`}
                onClick={() => setRestartMode('same')}
              >
                Same amount for all
              </button>
              <button
                type="button"
                className={`ghost-button ${restartMode === 'individual' ? 'filter-active' : ''}`}
                onClick={() => setRestartMode('individual')}
              >
                Enter each participant purse
              </button>
            </div>

            {restartMode === 'same' ? (
              <div className="stack-form">
                <label className="label" htmlFor="samePurseAmount">Purse amount for all participants</label>
                <input
                  id="samePurseAmount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={samePurseAmount}
                  onChange={(event) => setSamePurseAmount(event.target.value)}
                />
              </div>
            ) : (
              <div className="info-list">
                {room.participants.map((participant) => (
                  <div key={participant.id} className="info-card">
                    <strong>{participant.name}</strong>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={individualPurses[participant.id] ?? ''}
                      onChange={(event) => {
                        const value = event.target.value;
                        setIndividualPurses((prev) => ({
                          ...prev,
                          [participant.id]: value,
                        }));
                      }}
                      placeholder="Purse amount"
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="control-buttons">
              <button type="button" onClick={handleRestartAuction}>Confirm Restart Auction</button>
              <button className="ghost-button" type="button" onClick={() => setShowRestartModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {room.status === 'ended' ? (
        <section className="panel">
          <h3>Auction Result: Items Bought by Participants</h3>
          <div className="participant-grid">
            {room.participants.map((participant, teamIndex) => {
              const orderedItems = getOrderedBoughtItems(participant);
              const mainItems = orderedItems.slice(0, 11);
              const substituteItems = orderedItems.slice(11);
              const captainItemId = captainByParticipantId[participant.id] ?? '';

              return (
                <div key={participant.id} className={`info-card participant-card ended-participant-card team-variant-${teamIndex % 5}`}>
                  <div className="participant-card-top">
                    <strong>{participant.name}</strong>
                    <span className="muted-text">Total: {orderedItems.length}</span>
                  </div>
                  {orderedItems.length ? (
                    <>
                      <div className="results-team-header" style={{ marginBottom: 10 }}>
                        <span className="muted-text">Captain</span>
                        <select
                          className="filter-select"
                          value={captainItemId}
                          onChange={(event) => {
                            const nextCaptainId = event.target.value;
                            setCaptainByParticipantId((prev) => ({
                              ...prev,
                              [participant.id]: nextCaptainId,
                            }));
                          }}
                        >
                          <option value="">Select captain</option>
                          {orderedItems.map((item) => (
                            <option key={item.id} value={String(item.id)}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="results-team-section">
                        <div className="results-team-header">
                          <span className="muted-text">Main (11)</span>
                        </div>
                        <div className="bought-subcards">
                          {mainItems.map((item) => (
                            <div key={item.id} className="bought-subcard item-card">
                              <div className="bought-subcard-content">
                                <strong>{item.name}</strong>
                                <span className="item-category-badge">{item.category || 'General'}</span>
                              </div>
                              {String(item.id) === String(captainItemId) ? <span className="captain-badge">C</span> : null}
                              <button
                                type="button"
                                className="item-edit-icon"
                                onClick={() => openItemEdit(item)}
                              >
                                &#9998;
                              </button>
                            </div>
                          ))}
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
                            substituteItems.map((item) => (
                              <div key={item.id} className="bought-subcard item-card">
                                <div className="bought-subcard-content">
                                  <strong>{item.name}</strong>
                                  <span className="item-category-badge">{item.category || 'General'}</span>
                                </div>
                                {String(item.id) === String(captainItemId) ? <span className="captain-badge">C</span> : null}
                                <button
                                  type="button"
                                  className="item-edit-icon"
                                  onClick={() => openItemEdit(item)}
                                >
                                  &#9998;
                                </button>
                              </div>
                            ))
                          ) : (
                            <span className="muted-text">No substitutes.</span>
                          )}
                        </div>
                      </div>
                    </>
                  ) : (
                    <span className="muted-text">No items bought.</span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
