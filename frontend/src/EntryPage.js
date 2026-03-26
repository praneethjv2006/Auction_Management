import React, { useState } from 'react';
import { requestJson } from './network';

export default function EntryPage({ onOrganizerLogin, onParticipantLogin }) {
  const [role, setRole] = useState('organizer');
  const [organizerAuthMode, setOrganizerAuthMode] = useState('login');
  const [organizerCode, setOrganizerCode] = useState('');
  const [signupName, setSignupName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupOtp, setSignupOtp] = useState('');
  const [otpRequested, setOtpRequested] = useState(false);
  const [verifiedOrganizerId, setVerifiedOrganizerId] = useState('');
  const [forgotEmail, setForgotEmail] = useState('');
  const [organizerIdPreview, setOrganizerIdPreview] = useState('');
  const [showForgotOrganizerModal, setShowForgotOrganizerModal] = useState(false);
  const [participantCode, setParticipantCode] = useState('');
  const [roomId, setRoomId] = useState('');
  const [forgotRoomEmail, setForgotRoomEmail] = useState('');
  const [showForgotRoomModal, setShowForgotRoomModal] = useState(false);
  const [devOtpPreview, setDevOtpPreview] = useState('');
  const [roomDetailsPreview, setRoomDetailsPreview] = useState([]);
  const [showOrganizerIdModal, setShowOrganizerIdModal] = useState(false);
  const [copiedOrganizerId, setCopiedOrganizerId] = useState(false);
  const [status, setStatus] = useState('');

  async function handleOrganizerLogin(event) {
    event.preventDefault();
    setStatus('');

    try {
      const data = await requestJson('/organizer/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizerCode }),
      });
      onOrganizerLogin(data);
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function handleParticipantLogin(event) {
    event.preventDefault();
    setStatus('');

    try {
      const data = await requestJson('/participants/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantCode, roomId }),
      });
      onParticipantLogin({ participant: data, roomId: Number(roomId) });
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function handleRequestSignupOtp(event) {
    event.preventDefault();
    setStatus('');
    setVerifiedOrganizerId('');
    setDevOtpPreview('');

    try {
      const data = await requestJson('/organizer/signup/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: signupName, email: signupEmail }),
      });
      setOtpRequested(true);
      setDevOtpPreview(data.devOtp || '');
      setStatus(data.message || 'OTP sent to email');
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function handleVerifySignupOtp(event) {
    event.preventDefault();
    setStatus('');

    try {
      const data = await requestJson('/organizer/signup/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: signupEmail, otp: signupOtp }),
      });

      setVerifiedOrganizerId(data.organizerCode);
      setOrganizerIdPreview('');
      setSignupOtp('');
      setOtpRequested(false);
      setDevOtpPreview('');
      setShowOrganizerIdModal(true);
      setStatus('Email verified. Organizer account created.');
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function handleCopyOrganizerId() {
    if (!verifiedOrganizerId) return;
    try {
      await navigator.clipboard.writeText(verifiedOrganizerId);
      setCopiedOrganizerId(true);
    } catch (error) {
      setStatus('Could not copy automatically. Please copy manually.');
    }
  }

  function redirectToOrganizerLogin() {
    setShowOrganizerIdModal(false);
    setOrganizerAuthMode('login');
    setOrganizerCode(verifiedOrganizerId);
    setCopiedOrganizerId(false);
  }

  async function handleForgotOrganizerId(event) {
    event.preventDefault();
    setStatus('');

    try {
      const data = await requestJson('/organizer/forgot-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail }),
      });
      setOrganizerIdPreview(data.organizerCodePreview || '');
      setShowForgotOrganizerModal(false);
      setStatus(data.message || 'Organizer ID sent to your email');
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function handleForgotRoomId(event) {
    event.preventDefault();
    setStatus('');
    setRoomDetailsPreview([]);

    try {
      const data = await requestJson('/participants/forgot-room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotRoomEmail }),
      });
      setRoomDetailsPreview(Array.isArray(data.roomDetailsPreview) ? data.roomDetailsPreview : []);
      setShowForgotRoomModal(false);
      setStatus(data.message || 'Room details sent to your email');
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
          <>
            {organizerAuthMode === 'login' ? (
              <>
                <form className="stack-form premium-auth-card" onSubmit={handleOrganizerLogin}>
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

                <div className="entry-link-area">
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => {
                      setOrganizerAuthMode('signup');
                      setStatus('');
                    }}
                  >
                    Don&apos;t have an account? Sign up
                  </button>
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => {
                      setShowForgotOrganizerModal(true);
                    }}
                  >
                    Forgot organizer ID
                  </button>
                </div>

                {organizerIdPreview ? (
                  <div className="status-banner">
                    Organizer ID preview: <strong>{organizerIdPreview}</strong>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                {verifiedOrganizerId ? (
                  <div className="status-banner organizer-id-reveal">
                    <span className="label">Organizer ID</span>
                    <strong>{verifiedOrganizerId}</strong>
                  </div>
                ) : null}

                <form className="stack-form premium-auth-card" onSubmit={handleRequestSignupOtp}>
                  <h3>Sign up as organizer</h3>
                  <input
                    value={signupName}
                    onChange={(event) => setSignupName(event.target.value)}
                    placeholder="Organizer name"
                    required
                  />
                  <input
                    type="email"
                    value={signupEmail}
                    onChange={(event) => setSignupEmail(event.target.value)}
                    placeholder="Organizer email"
                    required
                  />
                  <button type="submit">Send OTP</button>
                </form>

                {otpRequested ? (
                  <form className="stack-form premium-auth-card" onSubmit={handleVerifySignupOtp}>
                    <h3>Verify email OTP</h3>
                    <input
                      value={signupOtp}
                      onChange={(event) => setSignupOtp(event.target.value)}
                      placeholder="6-digit OTP"
                      maxLength={6}
                      required
                    />
                    <button type="submit">Verify and create organizer account</button>
                    {devOtpPreview ? <span className="muted-text">Local OTP preview: {devOtpPreview}</span> : null}
                  </form>
                ) : null}

                <div className="entry-link-area">
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => {
                      setOrganizerAuthMode('login');
                      setStatus('');
                    }}
                  >
                    Already have an organizer ID? Login
                  </button>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <form className="stack-form premium-auth-card" onSubmit={handleParticipantLogin}>
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

            <div className="entry-link-area">
              <button
                type="button"
                className="text-link"
                onClick={() => setShowForgotRoomModal(true)}
              >
                Forgot Room ID?
              </button>
            </div>

            {roomDetailsPreview.length ? (
              <div className="status-banner">
                {roomDetailsPreview.map((entry) => (
                  <div key={`${entry.roomId}-${entry.participantCode}`}>
                    Room {entry.roomId} ({entry.roomName}) - Participant ID {entry.participantCode}
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}
      </section>

      {showForgotOrganizerModal ? (
        <div className="modal-overlay">
          <div className="modal-content">
            <button className="modal-close-button" type="button" onClick={() => setShowForgotOrganizerModal(false)}>
              &times;
            </button>
            <h3>Forgot Organizer ID</h3>
            <form className="stack-form" onSubmit={handleForgotOrganizerId}>
              <input
                type="email"
                value={forgotEmail}
                onChange={(event) => setForgotEmail(event.target.value)}
                placeholder="Organizer email"
                required
              />
              <button type="submit">Send organizer ID to email</button>
            </form>
          </div>
        </div>
      ) : null}

      {showForgotRoomModal ? (
        <div className="modal-overlay">
          <div className="modal-content">
            <button className="modal-close-button" type="button" onClick={() => setShowForgotRoomModal(false)}>
              &times;
            </button>
            <h3>Forgot Room ID</h3>
            <form className="stack-form" onSubmit={handleForgotRoomId}>
              <input
                type="email"
                value={forgotRoomEmail}
                onChange={(event) => setForgotRoomEmail(event.target.value)}
                placeholder="Participant email"
                required
              />
              <button type="submit">Send room details</button>
            </form>
          </div>
        </div>
      ) : null}

      {showOrganizerIdModal ? (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>Organizer Account Created</h3>
            <p className="muted-text">Use this organizer ID to login.</p>
            <div className="status-banner organizer-id-reveal">
              <span className="label">Organizer ID</span>
              <strong>{verifiedOrganizerId}</strong>
            </div>
            <div className="control-buttons" style={{ marginTop: 0 }}>
              <button type="button" onClick={handleCopyOrganizerId}>Copy Organizer ID</button>
              <button className="ghost-button" type="button" onClick={redirectToOrganizerLogin}>
                Go to Organizer Login
              </button>
            </div>
            {copiedOrganizerId ? <span className="muted-text">Organizer ID copied.</span> : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}
