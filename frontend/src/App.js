
import React, { useEffect, useMemo, useState } from 'react';
import './App.css';
import usePage from './usePage';
import EntryPage from './EntryPage';
import OrganizerDashboard from './OrganizerDashboard';
import OrganizerRoomPage from './OrganizerRoomPage';
import ParticipantRoomPage from './ParticipantRoomPage';

const SESSION_KEY = 'auction_session_v1';

function App() {
  const storedSession = useMemo(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }, []);

  const [page, goto] = usePage(storedSession?.page?.name || 'entry', storedSession?.page?.props || {});
  const [organizer, setOrganizer] = useState(storedSession?.organizer || null);
  const [participant, setParticipant] = useState(storedSession?.participant || null);

  useEffect(() => {
    const snapshot = {
      page,
      organizer,
      participant,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(snapshot));
  }, [page, organizer, participant]);

  function resetSessionToEntry() {
    setOrganizer(null);
    setParticipant(null);
    goto('entry');
    localStorage.removeItem(SESSION_KEY);
  }

  if (page.name === 'entry') {
    return (
      <EntryPage
        onOrganizerLogin={(data) => {
          setOrganizer(data);
          setParticipant(null);
          goto('organizer-dashboard');
        }}
        onParticipantLogin={({ participant: participantData, roomId }) => {
          setParticipant({ ...participantData, roomId });
          setOrganizer(null);
          goto('participant-room', { roomId, participantId: participantData.id });
        }}
      />
    );
  }

  if (page.name === 'organizer-dashboard' && organizer) {
    return (
      <OrganizerDashboard
        organizer={organizer}
        onEnterRoom={(roomId) => goto('organizer-room', { roomId })}
        onLogout={resetSessionToEntry}
      />
    );
  }

  if (page.name === 'organizer-room' && organizer) {
    return (
      <main className="app-shell">
        <OrganizerRoomPage
          roomId={page.props.roomId}
          organizer={organizer}
          onBack={() => goto('organizer-dashboard')}
        />
      </main>
    );
  }

  if (page.name === 'participant-room' && participant) {
    return (
      <main className="app-shell">
        <ParticipantRoomPage
          participant={participant}
          roomId={participant.roomId}
          onBack={() => goto('entry')}
          onLogout={resetSessionToEntry}
        />
      </main>
    );
  }

  return <EntryPage onOrganizerLogin={() => {}} onParticipantLogin={() => {}} />;
}

export default App;
