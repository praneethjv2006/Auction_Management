import React, { useEffect, useEffectEvent, useState } from 'react';
import { requestJson } from './network';

export default function OrganizerDashboard({ organizer, onEnterRoom, onLogout }) {
  const [rooms, setRooms] = useState([]);
  const [selectedRoomId, setSelectedRoomId] = useState(null);
  const [roomName, setRoomName] = useState('');
  const [participantName, setParticipantName] = useState('');
  const [participantPurse, setParticipantPurse] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [itemName, setItemName] = useState('');
  const [itemPrice, setItemPrice] = useState('');
  const [itemCategory, setItemCategory] = useState('');
  const [dashboardItemCategoryFilter, setDashboardItemCategoryFilter] = useState('all');
  const [editingParticipantId, setEditingParticipantId] = useState(null);
  const [editingParticipantName, setEditingParticipantName] = useState('');
  const [editingParticipantPurse, setEditingParticipantPurse] = useState('');
  const [editingItemId, setEditingItemId] = useState(null);
  const [editingItemName, setEditingItemName] = useState('');
  const [editingItemPrice, setEditingItemPrice] = useState('');
  const [editingItemCategory, setEditingItemCategory] = useState('');
  const [showItemEditModal, setShowItemEditModal] = useState(false);
  const [status, setStatus] = useState('Loading rooms...');

  const selectedRoom = rooms.find((room) => room.id === selectedRoomId) || null;

  const loadRooms = useEffectEvent(async () => {
    try {
      const roomsResponse = await requestJson(`/rooms?organizerId=${organizer.id}`);
      setRooms(roomsResponse);
      setSelectedRoomId((currentRoomId) => {
        if (currentRoomId && roomsResponse.some((room) => room.id === currentRoomId)) {
          return currentRoomId;
        }
        return roomsResponse[0]?.id ?? null;
      });
      setStatus('Rooms loaded.');
    } catch (error) {
      setStatus(error.message || 'Could not connect to auction server.');
    }
  });

  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  useEffect(() => {
    if (!selectedRoom) {
      setItemCategory('');
      return;
    }

    const categories = selectedRoom.categories || [];
    if (!categories.length) {
      setItemCategory('');
      return;
    }

    if (!categories.some((entry) => entry.name === itemCategory)) {
      setItemCategory(categories[0].name);
    }
  }, [selectedRoom, itemCategory]);

  async function handleCreateRoom(event) {
    event.preventDefault();

    try {
      const newRoom = await requestJson('/rooms', {
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
      const participant = await requestJson(`/rooms/${selectedRoom.id}/participants`, {
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

    if (!(selectedRoom.categories || []).length) {
      setStatus('Add at least one category for this room before adding items.');
      return;
    }

    try {
      const item = await requestJson(`/rooms/${selectedRoom.id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: itemName,
          price: itemPrice,
          category: itemCategory,
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

  async function handleAddCategory(event) {
    event.preventDefault();

    if (!selectedRoom) {
      setStatus('Create and open a room first.');
      return;
    }

    try {
      const category = await requestJson(`/rooms/${selectedRoom.id}/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: categoryName }),
      });

      setCategoryName('');
      setStatus(`Category ${category.name} added.`);
      await loadRooms();
      setSelectedRoomId(selectedRoom.id);
      setItemCategory(category.name);
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function handleDeleteCategory(categoryId) {
    if (!selectedRoom) return;

    const category = (selectedRoom.categories || []).find((entry) => entry.id === categoryId);
    if (!category) return;

    const confirmed = window.confirm(`Delete category "${category.name}"? Items in this category will move to General.`);
    if (!confirmed) return;

    try {
      const updatedRoom = await requestJson(`/rooms/${selectedRoom.id}/categories/${categoryId}`, {
        method: 'DELETE',
      });
      setStatus('Category deleted.');
      setRooms((prev) => prev.map((room) => (room.id === updatedRoom.id ? updatedRoom : room)));
      setSelectedRoomId(updatedRoom.id);

      if (itemCategory === category.name) {
        const nextCategory = (updatedRoom.categories || [])[0]?.name || '';
        setItemCategory(nextCategory);
      }
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function handleDeleteRoom(roomId) {
    const room = rooms.find((entry) => entry.id === roomId);
    if (!room) return;

    const confirmed = window.confirm(`Delete room "${room.roomName}"? This removes all items and participants.`);
    if (!confirmed) return;

    try {
      await requestJson(`/rooms/${roomId}`, { method: 'DELETE' });
      setStatus('Room deleted.');
      await loadRooms();
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function handleDeleteItem(itemId) {
    if (!selectedRoom) return;

    const item = selectedRoom.items.find((entry) => entry.id === itemId);
    if (!item) return;

    const confirmed = window.confirm(`Delete item "${item.name}"? This cannot be undone.`);
    if (!confirmed) return;

    try {
      const updatedRoom = await requestJson(`/rooms/${selectedRoom.id}/items/${itemId}`, { method: 'DELETE' });
      setStatus('Item deleted.');
      setRooms((prev) => prev.map((room) => (room.id === updatedRoom.id ? updatedRoom : room)));
      setSelectedRoomId(updatedRoom.id);
    } catch (error) {
      setStatus(error.message);
    }
  }

  function startParticipantEdit(participant) {
    setEditingParticipantId(participant.id);
    setEditingParticipantName(participant.name || '');
    setEditingParticipantPurse(String(participant.purseAmount ?? ''));
  }

  async function handleParticipantEditSave(participantId) {
    if (!selectedRoom) return;
    if (!editingParticipantName.trim()) {
      setStatus('Participant name is required.');
      return;
    }
    if (editingParticipantPurse === '' || isNaN(Number(editingParticipantPurse)) || Number(editingParticipantPurse) < 0) {
      setStatus('Valid purse amount is required.');
      return;
    }

    // Close edit mode immediately on Save click
    setEditingParticipantId(null);
    setEditingParticipantName('');
    setEditingParticipantPurse('');

    try {
      const updatedRoom = await requestJson(`/rooms/${selectedRoom.id}/participants/${participantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editingParticipantName.trim(),
          purseAmount: Number(editingParticipantPurse),
        }),
      });
      setStatus('Participant updated successfully.');
      setRooms((prev) => prev.map((room) => (room.id === updatedRoom.id ? updatedRoom : room)));
      setSelectedRoomId(updatedRoom.id);
    } catch (error) {
      setStatus(error.message);
    }
  }

  function startItemEdit(item) {
    setEditingItemId(item.id);
    setEditingItemName(item.name || '');
    setEditingItemPrice(String(item.price ?? ''));
    setEditingItemCategory(item.category || '');
    setShowItemEditModal(true);
  }

  async function handleItemEditSave(itemId) {
    if (!selectedRoom) return;

    try {
      const updatedRoom = await requestJson(`/rooms/${selectedRoom.id}/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editingItemName,
          price: editingItemPrice,
          category: editingItemCategory,
        }),
      });

      setStatus('Item updated successfully.');
      setEditingItemId(null);
      setShowItemEditModal(false);
      setRooms((prev) => prev.map((room) => (room.id === updatedRoom.id ? updatedRoom : room)));
      setSelectedRoomId(updatedRoom.id);
    } catch (error) {
      setStatus(error.message);
    }
  }

  const selectedRoomCategories = selectedRoom?.categories || [];
  const selectedRoomItemCategoryNames = selectedRoom
    ? Array.from(
        new Set(
          selectedRoom.items
            .map((item) => String(item.category || '').trim())
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b))
    : [];
  const selectedRoomCategoryNames = Array.from(
    new Set([
      ...selectedRoomCategories.map((category) => String(category.name || '').trim()).filter(Boolean),
      ...selectedRoomItemCategoryNames,
    ])
  ).sort((a, b) => a.localeCompare(b));
  const filteredSelectedItems = selectedRoom
    ? selectedRoom.items.filter((item) => (
      dashboardItemCategoryFilter === 'all' || (item.category || 'General') === dashboardItemCategoryFilter
    ))
    : [];

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
                <div className="item-filter-row">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => onEnterRoom(room.id)}
                  >
                    Enter Auction
                  </button>
                  <button
                    type="button"
                    className="ghost-button danger-button"
                    onClick={() => handleDeleteRoom(room.id)}
                  >
                    Delete Room
                  </button>
                </div>
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

              <div className="panel-header" style={{ marginBottom: 10 }}>
                <span className="label">Room categories</span>
                <button type="button" className="ghost-button" onClick={() => setShowCategoryModal(true)}>
                  Add / Manage Categories
                </button>
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
                  <select
                    value={itemCategory}
                    onChange={(event) => setItemCategory(event.target.value)}
                    disabled={selectedRoomCategories.length === 0}
                    required
                  >
                    {selectedRoomCategories.length === 0 ? <option value="">No categories available</option> : null}
                    {selectedRoomCategories.map((category) => (
                      <option key={category.id} value={category.name}>{category.name}</option>
                    ))}
                  </select>
                  <button type="submit">Add item</button>
                </form>
              </div>

              <div className="lists-grid">
                <section>
                  <h3>Participants list</h3>
                  <div className="info-list">
                    {selectedRoom.participants.map((participant) => (
                      <div key={participant.id} className="info-card">
                        {editingParticipantId === participant.id ? (
                          <>
                            <input
                              value={editingParticipantName}
                              onChange={(event) => setEditingParticipantName(event.target.value)}
                              placeholder="Participant name"
                            />
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={editingParticipantPurse}
                              onChange={(event) => setEditingParticipantPurse(event.target.value)}
                              placeholder="Purse"
                            />
                            <div className="item-filter-row">
                              <button type="button" onClick={() => handleParticipantEditSave(participant.id)}>
                                Save
                              </button>
                              <button type="button" className="ghost-button" onClick={() => setEditingParticipantId(null)}>
                                Cancel
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <strong>{participant.name}</strong>
                            <span>ID: {participant.participantCode}</span>
                            <span>Purse: {participant.purseAmount}</span>
                            <button type="button" className="pencil-button" onClick={() => startParticipantEdit(participant)}>
                              &#9998;
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                    {selectedRoom.participants.length === 0 ? (
                      <p>No participants added yet.</p>
                    ) : null}
                  </div>
                </section>

                <section>
                  <h3>Items list</h3>
                  <div className="item-filter-row" style={{ marginBottom: 10 }}>
                    <select
                      className="filter-select"
                      value={dashboardItemCategoryFilter}
                      onChange={(event) => setDashboardItemCategoryFilter(event.target.value)}
                    >
                      <option value="all">All Categories</option>
                      {selectedRoomCategoryNames.map((categoryName) => (
                        <option key={categoryName} value={categoryName}>{categoryName}</option>
                      ))}
                    </select>
                  </div>
                  <div className="info-list">
                    {filteredSelectedItems.map((item) => (
                      <div key={item.id} className="info-card item-card">
                        <strong>{item.name}</strong>
                        <span>ID: {item.id}</span>
                        <span>Category: {item.category || 'General'}</span>
                        <span>Price: {item.price}</span>
                        <div className="item-filter-row">
                          <button
                            type="button"
                            className="ghost-button danger-button"
                            onClick={() => handleDeleteItem(item.id)}
                          >
                            Delete
                          </button>
                        </div>
                        <button type="button" className="item-edit-icon" onClick={() => startItemEdit(item)}>
                          &#9998;
                        </button>
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

      {showCategoryModal && selectedRoom ? (
        <div className="modal-overlay">
          <div className="modal-content">
            <button className="modal-close-button" type="button" onClick={() => setShowCategoryModal(false)}>
              &times;
            </button>
            <h3>Manage Categories: {selectedRoom.roomName}</h3>
            <form className="stack-form" onSubmit={handleAddCategory}>
              <input
                value={categoryName}
                onChange={(event) => setCategoryName(event.target.value)}
                placeholder="Category name"
                required
              />
              <button type="submit">Add category</button>
            </form>
            <div className="item-filter-row">
              {selectedRoomCategories.map((category) => (
                <span key={category.id} className="item-category-badge" style={{ gap: 8 }}>
                  <span>{category.name}</span>
                  <button
                    type="button"
                    className="ghost-button danger-button"
                    style={{ padding: '0.15rem 0.5rem', height: 'auto' }}
                    onClick={() => handleDeleteCategory(category.id)}
                    aria-label={`Delete category ${category.name}`}
                  >
                    &times;
                  </button>
                </span>
              ))}
              {selectedRoomCategories.length === 0 ? <span className="muted-text">No categories yet.</span> : null}
            </div>
          </div>
        </div>
      ) : null}

      {showItemEditModal && selectedRoom ? (
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
                {selectedRoomCategories.length === 0 ? (
                  <option value="General">General</option>
                ) : (
                  selectedRoomCategories.map((category) => (
                    <option key={category.id} value={category.name}>{category.name}</option>
                  ))
                )}
              </select>
            </div>
            <div className="control-buttons">
              <button type="button" onClick={() => handleItemEditSave(editingItemId)}>Save Changes</button>
              <button
                className="ghost-button"
                type="button"
                onClick={() => {
                  setShowItemEditModal(false);
                  setEditingItemId(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
