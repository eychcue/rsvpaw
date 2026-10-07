# 🐾 RSVPaw

**Your event concierge over iMessage.** RSVPaw finds SF events you'll love, signs you up (answering the form questions for you), tracks host approvals, adds approved events to your calendar, and checks you can still make it, cancelling for you if not so hosts know who's really coming.

Live: https://rsvpaw.vercel.app · Built at the Agent37 "Build an Agent" hackathon (Oct 7 2026).

## How it works
1. **Sign up** at rsvpaw.vercel.app → text RSVPaw on iMessage → get a welcome + contact card.
2. **Connect Luma / Partiful by text.** No passwords: your Agent37 computer starts the login, you text back the one-time code.
3. **Discover**: pulls Luma's SF discover feed; your Agent37 agent scores every event against your 👍/👎 history, with a reason.
4. **Register**: reply `1/2/3` (or 👍 on the web deck). The agent opens the event in its browser and fills the form from your profile.
5. **Track**: pending → approved pings + Google Calendar link.
6. **Remind**: "Can you still make it?" Reply `no` and it cancels your RSVP.

## Stack
| | |
|---|---|
| **Agent37** | One hosted agent computer per user (Hermes): taste scoring, browser registration/cancel, Luma/Partiful OTP login |
| **Supabase** | Users (keyed by phone), events, swipes, registration status, activity feed, outbox; Realtime dashboard |
| **Photon** (spectrum-ts) | iMessage line: inbound/outbound, branded vCard |
| **Next.js on Vercel** | Signup landing page + live dashboard |

## Run
```bash
cp .env.example .env.local   # fill in keys
# Supabase SQL editor: run supabase/schema.sql
npm i
npm run dev      # web on :3000
npm run bot      # iMessage bot (long-lived Photon connection)
```
