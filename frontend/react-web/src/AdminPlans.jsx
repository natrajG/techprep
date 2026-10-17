import { useEffect, useState } from "react";
import { fetchPlans, updatePlan } from "./subscriptions.mjs";

const API = import.meta.env.VITE_API_URL || "";
const notifyExpired = () => window.dispatchEvent(new Event("auth-expired"));

export default function AdminPlans() {
  const [plans, setPlans] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState("");

  useEffect(() => {
    fetchPlans(API)
      .then(({ plans: loaded }) => {
        setPlans(loaded);
        setDrafts(Object.fromEntries(loaded.map((plan) => [plan.id, {
          amount: plan.amount,
          ...(plan.id === "monthly"
            ? { call_limit: plan.call_limit, duration_days: plan.duration_days }
            : { duration_minutes: plan.duration_minutes }),
        }])));
      })
      .catch((e) => setError(`Cannot load plan settings: ${e.message}`));
  }, []);

  async function save(event, planId) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSaving(planId);
    try {
      const plan = await updatePlan(API, planId, drafts[planId], fetch, localStorage, notifyExpired);
      setPlans((current) => current.map((item) => item.id === planId ? plan : item));
      setMessage(`${plan.name} updated. Existing orders and subscriptions keep their original terms.`);
    } catch (e) {
      setError(`Cannot update plan: ${e.message}`);
    } finally {
      setSaving("");
    }
  }

  return (
    <section style={styles.section}>
      <h3 style={{ margin: "0 0 6px" }}>Admin · Plan Settings</h3>
      <p style={styles.help}>Changes affect new payment orders only. Reopen pricing to see updated offers.</p>
      {plans.map((plan) => (
        <form key={plan.id} onSubmit={(event) => save(event, plan.id)} style={styles.form}>
          <strong>{plan.name}</strong>
          <label style={styles.label}>Price (₹)
            <input style={styles.input} type="number" min="1" max="1000000" required
              value={drafts[plan.id]?.amount ?? ""}
              onChange={(event) => setDrafts((current) => ({
                ...current, [plan.id]: { ...current[plan.id], amount: Number(event.target.value) },
              }))} />
          </label>
          {plan.id === "monthly" ? <>
            <label style={styles.label}>One-hour calls
              <input style={styles.input} type="number" min="1" max="1000" required
                value={drafts[plan.id]?.call_limit ?? ""}
                onChange={(event) => setDrafts((current) => ({
                  ...current, [plan.id]: { ...current[plan.id], call_limit: Number(event.target.value) },
                }))} />
            </label>
            <label style={styles.label}>Plan duration (days)
              <input style={styles.input} type="number" min="1" max="365" required
                value={drafts[plan.id]?.duration_days ?? ""}
                onChange={(event) => setDrafts((current) => ({
                  ...current, [plan.id]: { ...current[plan.id], duration_days: Number(event.target.value) },
                }))} />
            </label>
          </> : <label style={styles.label}>Call duration (minutes)
            <input style={styles.input} type="number" min="1" max="1440" required
              value={drafts[plan.id]?.duration_minutes ?? ""}
              onChange={(event) => setDrafts((current) => ({
                ...current, [plan.id]: { ...current[plan.id], duration_minutes: Number(event.target.value) },
              }))} />
          </label>}
          <button type="submit" disabled={Boolean(saving)} style={styles.button}>
            {saving === plan.id ? "Saving…" : "Save"}
          </button>
        </form>
      ))}
      {error && <p role="alert" style={{ color: "#fca5a5" }}>{error}</p>}
      {message && <p role="status" style={{ color: "#86efac" }}>{message}</p>}
    </section>
  );
}

const styles = {
  section: {
    background: "rgba(99, 102, 241, 0.07)", border: "1px solid rgba(129, 140, 248, 0.3)",
    borderRadius: 12, padding: 16, color: "#f8fafc",
  },
  help: { fontSize: 12, color: "#94a3b8", margin: "0 0 14px" },
  form: { display: "flex", flexWrap: "wrap", alignItems: "end", gap: 12, marginTop: 12 },
  label: { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#cbd5e1" },
  input: {
    width: 108, padding: 7, borderRadius: 6, border: "1px solid #475569",
    background: "#151b2b", color: "#fff",
  },
  button: { padding: "8px 14px", border: 0, borderRadius: 7, background: "#4f46e5", color: "#fff", cursor: "pointer" },
};
