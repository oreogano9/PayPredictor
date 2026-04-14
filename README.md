# Money Counter

Standalone React version of the Net Earnings Tracker.

## Run

Open `index.html` in a browser, or serve the folder with any static server.

The app runs in local-storage mode by default, so shifts and weekly totals persist in the current browser without Firebase.

The `Track` mode lets you choose the actual start time in 30-minute intervals before starting a shift. The `Predict` mode defaults to today and estimates a day from selected date, start time, and end time. If the end time is earlier than or equal to the start time, the prediction treats it as an overnight shift ending the next day.

The `Calendar` mode shows a month grid. Click a day to load it into the editor, then set start/end times and add or update a shift. Monthly prediction sorts shifts by date, groups paid hours by calendar week, and applies the same automatic pay codes, night premiums, holiday/Sunday rules, and unpaid lunch break rule.

March 2026 payslip shifts and the April 2026 plan are seeded into the calendar when no saved calendar entries exist.

## Pay Rules

The calculator uses these payslip-derived rules:

- Regular hours: base rate, `6.24925` per hour
- Extra day hours after 30h: base + 15%, guessed automatically after 30 paid hours in the current weekly total
- Overtime after 38.5h: base + 25%, guessed automatically after 38.5 paid hours in the current weekly total
- Extra night weekday hours: base + 50%, guessed automatically for extra paid hours between 20:00 and 08:00 on non-Sunday/non-holiday days; these hours do not also receive the separate `NTT` premium
- In the monthly planner, `S15`/extra night weekday hours are guessed after the payslip ordinary monthly quota of `130` paid hours; `S25` still follows the 38.5h weekly overtime threshold
- `NTT`: weekday night premium, +50% of base, between 20:00 and 08:00
- `NTD`: Sunday/holiday night premium, +55% of base, between 20:00 and 08:00
- `Pausa pranzo`: 30 unpaid minutes are deducted from paid time once a shift reaches 7 hours, including exactly 7 hours
- Monthly calendar total subtracts a `46.00` parking deduction from earnings when the month has shifts
- Food vouchers are `8.00` per shift with a total span of at least 6 hours; the monthly headline includes them, and the breakdown still shows vouchers separately from earnings
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
