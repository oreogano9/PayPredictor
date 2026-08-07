# Money Counter

Standalone React version of the Net Earnings Tracker.

## Run

Open `index.html` in a browser, or serve the folder with any static server.

The app runs in local-storage mode by default, so shifts and weekly totals persist in the current browser without Firebase.

## Vercel user backups

The app keeps using the same local-storage keys as previous releases. Creating an account adds a private Vercel Blob copy and never removes the browser copy.

To enable account backups on Vercel:

1. Create and connect a Blob store with **Private** access.
2. Add `PAYPREDICTOR_AUTH_SECRET` as an environment variable with a random value of at least 32 characters.
3. Add `PAYPREDICTOR_STATS_SECRET` with a different random value of at least 32 characters to enable the internal user count.
4. Redeploy after connecting the store and adding the variables.

The normalized username locates the account, the four-digit PIN is stored only as a salted hash, and the browser remembers a signed login token. A four-digit PIN is convenience-level security and should not be reused anywhere else.

Signed-in users can change their username or replace their PIN from Settings. Credential changes preserve the existing backup, issue a new signed session, and invalidate sessions created with the previous credentials.

Each account has a server-generated stable ID. Renaming an account or changing its PIN keeps that ID, so the internal count remains a count of unique users. Existing accounts receive an ID automatically the next time they log in, restore, save, or update their credentials.

The aggregate count is available only with the stats secret and returns no usernames, PIN data, or calendar data:

```sh
npm run users:count
npm run users:list
```

The first command returns aggregate diagnostics. The second also returns the account display names, without calendar data or PIN information. Both commands read `PAYPREDICTOR_STATS_SECRET` from the environment. On the maintainer's Mac they can also read the secret from the `PayPredictor Stats API` Keychain item. The underlying endpoint can be queried directly when needed:

```sh
curl -sS https://YOUR-DOMAIN/api/account \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $PAYPREDICTOR_STATS_SECRET" \
  --data '{"action":"stats"}'
```

`uniqueUsers` is the deduplicated account total. `activeRecords` and `legacyRecords` are diagnostics for migrations and should not be used as the user total.

The `Track` mode lets you choose the actual start time in 30-minute intervals before starting a shift. The `Predict` mode defaults to today and estimates a day from selected date, start time, and end time. If the end time is earlier than or equal to the start time, the prediction treats it as an overnight shift ending the next day.

The `Calendar` mode shows a month grid. Click a day to load it into the editor, then set start/end times and add or update a shift. Monthly prediction sorts shifts by date, groups paid hours by calendar week, and applies the same automatic pay codes, night premiums, holiday/Sunday rules, and unpaid lunch break rule.

Applying a PDF replaces only earlier PDF-imported shifts in the same month. Other months, manual shifts, and iCal data are preserved.

## Pay Rules

The calculator uses these payslip-derived rules:

- Regular hours: base rate, `6.24925` per hour
- Extra day hours after 30h: base + 15%, guessed automatically after 30 paid hours in the current weekly total
- Overtime after 38.5h: base + 25%, guessed automatically after 38.5 paid hours in the current weekly total
- Extra night weekday hours: base + 50%, guessed automatically for extra paid hours between 20:00 and 08:00 on non-Sunday/non-holiday days; these hours do not also receive the separate `NTT` premium
- In the monthly planner, `S15`/extra night weekday hours are guessed after the payslip ordinary monthly quota of `130` paid hours; `S25` still follows the 38.5h weekly overtime threshold
- `NTT`: weekday night premium, +50% of base, between 20:00 and 08:00
- `NTD`: Sunday/holiday night premium, +55% of base, between 20:00 and 08:00
- `Pausa pranzo`: at most 30 unpaid minutes are deducted per work day once its combined shifts reach 7 hours, including exactly 7 hours
- Monthly calendar total subtracts a `46.00` parking deduction from earnings when the month has shifts
- Food vouchers are `8.00` per work day whose combined shifts reach at least 6 hours; the monthly headline includes them, and the breakdown still shows vouchers separately from earnings
- Payslip net estimate uses March 2026-calibrated payroll assumptions: `920.77 / 130` regular hourly pay, payslip rates for `S15`/`S50`/`S25`/`NTT`/`NTD`, daily turnista allowances, visible INPS/IRPEF/substitute-tax deductions, `101.91` treatment credit, `53.15` L.207/24 indemnity, and `0.44` rounding

## Firebase

To use Firebase sync, define these globals before the app script in `index.html`:

```html
<script>
  window.__firebase_config = JSON.stringify({
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_FIREBASE_APP_ID"
  });
  window.__app_id = "earnings-tracker-it";
  window.__initial_auth_token = "";
</script>
```

If `window.__initial_auth_token` is empty, the app signs in anonymously.
