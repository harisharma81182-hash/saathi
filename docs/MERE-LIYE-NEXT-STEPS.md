# Himanshu ke liye: aage kya karna hai (27 Oct)

Deadline: **aaj raat 11:59 IST**. Live app: https://saathi-ksk8.onrender.com

## 1. Kya poora hua

| # | Feature | Status |
|---|---|---|
| 1 | Reminders par black hole background (NASA) | ✅ |
| 2 | Har cheez ki notification (reminder, task due, overdue, subah, raat, countdown, study, timer, achievement, chat) | ✅ |
| 3 | Har device par push (service worker, VAPID, iPhone guide) | ✅ (asli phone par tum test karo) |
| 4 | Notification button/section hataya, pehle click par permission, email fallback | ✅ (email ke liye SMTP bharna hoga) |
| 5 | AI se dost wale messages, emoji, icon, photo, buttons | ✅ |
| 6 | Custom focus timer (koi bhi time, chat se bhi) | ✅ |
| 7 | Timer khatam par celebration | ✅ |
| 8 | Bada premium popup | ✅ |
| 9 | Voice (mic + bolkar jawab) | ✅ (Edge mein best) |
| 10 | README mein live link aur screenshots | ✅ |

Abhi baaki (sirf tum kar sakte ho): Render mein naye variables, SMTP, UptimeRobot, repo Public, demo video, Google Form.

## 2. Render mein NAYE variables

Render → apni service → **Environment** → **Add Environment Variable**. Naam:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `APP_URL` → value: `https://saathi-ksk8.onrender.com`
- `CLIENT_ORIGIN` → value: `https://saathi-ksk8.onrender.com` (agar pehle se nahi hai)
- `SMTP_HOST` → value: `smtp.gmail.com`
- `SMTP_PORT` → value: `465`
- `SMTP_SECURE` → value: `true`
- `SMTP_USER` → tumhara Gmail
- `SMTP_PASS` → Gmail App Password (neeche dekho)
- `MAIL_FROM` → tumhara Gmail

**Value bina screen par dikhaye copy karna.** PowerShell mein `saathi` folder kholo. Har ek ke liye ek command chalao, phir Render ke box mein **Ctrl+V** karo:

```powershell
((Get-Content server\.env | Where-Object { $_ -like 'VAPID_PUBLIC_KEY=*' }) -replace '^VAPID_PUBLIC_KEY=','') | Set-Clipboard
```
```powershell
((Get-Content server\.env | Where-Object { $_ -like 'VAPID_PRIVATE_KEY=*' }) -replace '^VAPID_PRIVATE_KEY=','') | Set-Clipboard
```
```powershell
((Get-Content server\.env | Where-Object { $_ -like 'VAPID_SUBJECT=*' }) -replace '^VAPID_SUBJECT=','') | Set-Clipboard
```

`VAPID_SUBJECT` mein `mailto:` ke baad apna asli email hona chahiye (jaise `mailto:tumhara@gmail.com`). Agar `saathi@example.com` dikhe toh Render mein khud apna email likh do.

Sab daalne ke baad **Save Changes**. Render apne aap dobara deploy karega (5 minute).

## 3. Gmail App Password aur SMTP

1. https://myaccount.google.com → **Security**.
2. **2-Step Verification** on karo (agar off hai).
3. Upar search box mein **App passwords** likho aur kholo.
4. Naam likho `Saathi` → **Create**. 16 akshar ka password dikhega.
5. Use seedha Render ke `SMTP_PASS` mein paste karo (spaces ke bina). **Chat mein ya kahin aur mat bhejna.**
6. Laptop par bhi chahiye toh `server\.env` mein `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER=...`, `SMTP_PASS=...`, `MAIL_FROM=...` daalo.

### Render par email: Brevo (zaroori)

Render ka free plan SMTP ports (25, 465, 587) block karta hai, isliye Gmail SMTP wahan timeout ho jaata hai. Hal: Brevo, jo email HTTPS se bhejta hai (free, din mein 300).

1. https://www.brevo.com par free account banao (apne Gmail se).
2. **Senders, domains & dedicated IPs** → **Senders** → **Add a sender** → apna Gmail daalo → email mein aaya link khol kar verify karo.
3. Upar right mein naam → **SMTP & API** → **API keys** → **Generate a new API key** → naam `Saathi` → key copy karo.
4. Render → Environment → `BREVO_API_KEY` mein paste karo. `MAIL_FROM` mein wahi verified Gmail ho. **Save Changes.**
5. Deploy ke baad app mein "Password bhool gaye?" try karo. Email spam folder mein bhi dekh lena.

### "Continue with Google" ke liye Client ID

1. https://console.cloud.google.com kholo, apne Gmail se login karo.
2. Upar project list → **New Project** → naam `Saathi` → **Create** → wahi project select karo.
3. Menu → **APIs & Services** → **OAuth consent screen** (ya **Google Auth Platform**) → **Get started**: app name `Saathi`, support email tumhara Gmail, audience **External**, contact email → **Create**.
4. **Audience** mein status **In production** kar do (**Publish app**). Warna sirf "test users" login kar payenge.
5. **Clients** (ya **Credentials** → **Create credentials** → **OAuth client ID**) → type **Web application** → naam `Saathi web`.
6. **Authorized JavaScript origins** mein do add karo:
   - `https://saathi-ksk8.onrender.com`
   - `http://localhost:5173`
   (Redirect URIs khaali chhod do.)
7. **Create** → **Client ID** copy karo (`...apps.googleusercontent.com` wala). Client secret ki zaroorat **nahi** hai.
8. Render → Environment → `GOOGLE_CLIENT_ID` mein paste → **Save Changes**. Laptop par bhi chahiye toh `server\.env` mein `GOOGLE_CLIENT_ID=...` daalo.
9. Deploy ke baad login page par "Continue with Google" dikhega. Origin badalne ke baad Google ko 5 minute lag sakte hain.

## 4. UptimeRobot (server ko jagaye rakhne ke liye)

1. https://uptimerobot.com par free account banao.
2. **Add New Monitor** → type **HTTP(s)**.
3. Friendly name: `Saathi`. URL: `https://saathi-ksk8.onrender.com/api/health/live`
4. Monitoring interval: **5 minutes** → **Create Monitor**.

Isse free server soyega nahi, aur reminders time par jayenge.

## 5. GitHub repo Public karna

1. https://github.com/harisharma81182-hash/saathi kholo.
2. **Settings** (upar) → sabse neeche **Danger Zone** → **Change visibility** → **Change to public**.
3. Repo ka naam likh kar confirm karo.

Pehle check kar lo: `.env` GitHub par nahi hai (yeh pakka hai, `.gitignore` mein hai).

## 6. Test kaise karein

**Laptop (Edge ya Chrome):**
1. Live app kholo, login karo, kahin bhi ek click karo → **Allow** dabao.
2. Chat mein likho: "2 minute baad paani peene ka reminder lagao". Tab band karo. 2 minute mein notification aani chahiye, buttons try karo.
3. Upar **Timer** → 1 minute → Shuru karo. Time pura hone par "Ho gaya ✅" dabao, celebration dikhega.
4. Chat box mein mic dabao aur bolo. Speaker button on karke jawab suno.

**Android (Chrome):**
1. Live app kholo → login → ek tap → Allow.
2. Reminder ya timer lagao, app band karo. Notification mein photo aur buttons dikhenge.
3. Menu (⋮) → **Install app** se icon ban jayega.

**iPhone (iOS 16.4 ya naya):**
1. Safari mein live app kholo → login. Guide dikhega.
2. Share → **Add to Home Screen**.
3. Home Screen wale Saathi icon se kholo → ek tap → Allow → reminder lagao.

**Email check:** browser mein notifications Block karo, app band karo, reminder lagao. Reminder email par aana chahiye (SMTP bhara hona chahiye).

## 7. Submit se pehle

**Submit karne se pehle teeno links (GitHub, Render live app, demo video) Incognito window (Ctrl + Shift + N) mein khol kar check karo. Sir ne khaas taur par ye bola hai.**

Teeno bina login ya permission maange khulne chahiye. Tabhi Google Form bharna.
