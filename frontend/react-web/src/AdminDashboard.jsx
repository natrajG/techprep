import { useEffect, useState } from "react";
import AdminFeedback from "./AdminFeedback";
import AdminPlans from "./AdminPlans";
import { fetchAdminUsers, grantAdminSubscription, revokeAdminSubscription } from "./admin.mjs";

const API = import.meta.env.VITE_API_URL || "";
const notifyExpired = () => window.dispatchEvent(new Event("auth-expired"));

export default function AdminDashboard({ user, onSignOut }) {
  const [activeTab, setActiveTab] = useState("users"); // 'users' | 'grant' | 'plans' | 'feedback'
  const [usersData, setUsersData] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [expandedUser, setExpandedUser] = useState(null);

  // Grant Form State
  const [grantUsername, setGrantUsername] = useState("");
  const [grantPlanId, setGrantPlanId] = useState("monthly");
  const [grantPlanName, setGrantPlanName] = useState("");
  const [grantCallLimit, setGrantCallLimit] = useState(30);
  const [grantDurationDays, setGrantDurationDays] = useState(30);
  const [grantDurationMinutes, setGrantDurationMinutes] = useState(60);
  const [grantReason, setGrantReason] = useState("");
  const [granting, setGranting] = useState(false);
  const [grantMessage, setGrantMessage] = useState("");
  const [grantError, setGrantError] = useState("");

  function loadUsers() {
    setLoading(true);
    setError("");
    fetchAdminUsers(API, fetch, localStorage, notifyExpired)
      .then((data) => {
        setUsersData(data.users || []);
        setSummary(data.summary || null);
        if (data.users?.length > 0 && !grantUsername) {
          setGrantUsername(data.users[0].username);
        }
      })
      .catch((e) => setError(`Failed to load users: ${e.message}`))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadUsers();
  }, []);

  function openGrantForUser(username) {
    setGrantUsername(username);
    setGrantPlanId("monthly");
    setGrantPlanName("");
    setGrantCallLimit(30);
    setGrantDurationDays(30);
    setGrantReason("Complimentary access");
    setGrantMessage("");
    setGrantError("");
    setActiveTab("grant");
  }

  async function handleGrantSubmit(e) {
    e.preventDefault();
    setGranting(true);
    setGrantMessage("");
    setGrantError("");

    const payload = {
      username: grantUsername.trim(),
      plan_id: grantPlanId,
      amount: 0,
      reason: grantReason.trim() || "Admin grant",
    };

    if (grantPlanName.trim()) {
      payload.plan_name = grantPlanName.trim();
    }

    if (grantPlanId === "monthly") {
      payload.duration_days = Number(grantDurationDays) || 30;
      payload.call_limit = Number(grantCallLimit) || 30;
    } else if (grantPlanId === "hourly_call") {
      payload.duration_minutes = Number(grantDurationMinutes) || 60;
      payload.call_limit = Number(grantCallLimit) || 1;
    } else {
      // Custom offer
      if (grantDurationDays) payload.duration_days = Number(grantDurationDays);
      if (grantCallLimit) payload.call_limit = Number(grantCallLimit);
    }

    try {
      const res = await grantAdminSubscription(API, payload, fetch, localStorage, notifyExpired);
      setGrantMessage(res.message || "Subscription successfully granted!");
      loadUsers();
    } catch (err) {
      setGrantError(err.message || "Failed to grant subscription.");
    } finally {
      setGranting(false);
    }
  }

  async function handleRevoke(username, subId) {
    if (!window.confirm(`Revoke active subscription for "${username}"?`)) return;
    try {
      await revokeAdminSubscription(API, { username, subscription_id: subId }, fetch, localStorage, notifyExpired);
      loadUsers();
    } catch (err) {
      alert(`Error revoking subscription: ${err.message}`);
    }
  }

  const filteredUsers = usersData.filter((u) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return u.username.toLowerCase().includes(q) || (u.email && u.email.toLowerCase().includes(q));
  });

  return (
    <div style={styles.container}>
      {/* Admin Navbar */}
      <header style={styles.navbar}>
        <div style={styles.navBrand}>
          <div style={styles.logoBadge}>TP</div>
          <div>
            <h1 style={styles.brandTitle}>TechPrep</h1>
            <span style={styles.adminBadge}>🛡️ Admin Console</span>
          </div>
        </div>

        <div style={styles.navUser}>
          <div style={styles.userPill}>
            <span style={styles.adminDot} />
            <span style={styles.userName}>{user}</span>
            <span style={styles.adminRoleTag}>SuperAdmin</span>
          </div>
          <button style={styles.signOutBtn} onClick={onSignOut}>
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main style={styles.main}>
        {/* Top Summary Metrics */}
        {summary && (
          <div style={styles.metricGrid}>
            <div style={styles.metricCard}>
              <span style={styles.metricLabel}>Total Registered Users</span>
              <strong style={styles.metricValue}>{summary.total_users}</strong>
            </div>
            <div style={styles.metricCard}>
              <span style={styles.metricLabel}>Active Subscriptions</span>
              <strong style={{ ...styles.metricValue, color: "#4ade80" }}>{summary.total_active_subs}</strong>
            </div>
            <div style={styles.metricCard}>
              <span style={styles.metricLabel}>Total Tokens Burned</span>
              <strong style={{ ...styles.metricValue, color: "#38bdf8" }}>
                {summary.total_tokens_burned.toLocaleString()}
              </strong>
            </div>
            <div style={styles.metricCard}>
              <span style={styles.metricLabel}>Total Recharges / Revenue</span>
              <strong style={{ ...styles.metricValue, color: "#facc15" }}>₹{summary.total_revenue.toLocaleString()}</strong>
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <div style={styles.tabBar}>
          <button
            style={activeTab === "users" ? styles.tabBtnActive : styles.tabBtn}
            onClick={() => setActiveTab("users")}
          >
            👥 Users &amp; Recharge History ({usersData.length})
          </button>
          <button
            style={activeTab === "grant" ? styles.tabBtnActive : styles.tabBtn}
            onClick={() => setActiveTab("grant")}
          >
            🎁 Grant Subscription / Offers
          </button>
          <button
            style={activeTab === "plans" ? styles.tabBtnActive : styles.tabBtn}
            onClick={() => setActiveTab("plans")}
          >
            ⚙️ Plan Pricing &amp; Offers
          </button>
          <button
            style={activeTab === "feedback" ? styles.tabBtnActive : styles.tabBtn}
            onClick={() => setActiveTab("feedback")}
          >
            💬 User Feedbacks
          </button>
        </div>

        {/* TAB 1: USERS & RECHARGE HISTORY */}
        {activeTab === "users" && (
          <section style={styles.sectionCard}>
            <div style={styles.sectionHeader}>
              <div>
                <h2 style={styles.sectionTitle}>User Directory &amp; Usage</h2>
                <p style={styles.sectionSubtitle}>
                  View all registered users, their AI token burn, active plans, and complete recharge history.
                </p>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input
                  type="text"
                  placeholder="Search username or email…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={styles.searchInput}
                />
                <button style={styles.refreshBtn} onClick={loadUsers} disabled={loading}>
                  {loading ? "Refreshing…" : "↻ Refresh"}
                </button>
              </div>
            </div>

            {error && <p style={styles.errorText}>{error}</p>}

            {loading && usersData.length === 0 ? (
              <p style={{ color: "#94a3b8", padding: 20 }}>Loading user records…</p>
            ) : filteredUsers.length === 0 ? (
              <p style={{ color: "#94a3b8", padding: 20 }}>No users matched your search.</p>
            ) : (
              <div style={styles.tableWrapper}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>User / Email</th>
                      <th style={styles.th}>Active Subscription</th>
                      <th style={styles.th}>AI Token Usage</th>
                      <th style={styles.th}>Recharges</th>
                      <th style={styles.th}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((u) => {
                      const active = u.active_subscription;
                      const isExpanded = expandedUser === u.username;
                      return (
                        <tr key={u.username} style={styles.tr}>
                          <td style={styles.td}>
                            <div style={{ fontWeight: 600, color: "#f8fafc" }}>{u.username}</div>
                            <div style={{ fontSize: 12, color: "#94a3b8" }}>{u.email || "No email"}</div>
                          </td>
                          <td style={styles.td}>
                            {active ? (
                              <div>
                                <span style={styles.activeTag}>{active.plan_name}</span>
                                <div style={{ fontSize: 11, color: "#cbd5e1", marginTop: 4 }}>
                                  Calls: <strong>{active.calls_remaining ?? 0}</strong> of {active.calls_total ?? "—"}
                                </div>
                                {active.valid_until && (
                                  <div style={{ fontSize: 10, color: "#94a3b8" }}>
                                    Expires: {new Date(active.valid_until * 1000).toLocaleDateString()}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span style={styles.inactiveTag}>No Active Plan</span>
                            )}
                          </td>
                          <td style={styles.td}>
                            <div style={{ fontWeight: 600, color: "#38bdf8" }}>
                              {u.token_usage?.total_tokens?.toLocaleString() || 0} tokens
                            </div>
                            <div style={{ fontSize: 11, color: "#94a3b8" }}>
                              In: {u.token_usage?.prompt_tokens?.toLocaleString() || 0} · Out:{" "}
                              {u.token_usage?.completion_tokens?.toLocaleString() || 0}
                            </div>
                          </td>
                          <td style={styles.td}>
                            <button
                              style={styles.historyBtn}
                              onClick={() => setExpandedUser(isExpanded ? null : u.username)}
                            >
                              {u.recharges?.length || 0} orders {isExpanded ? "▲" : "▼"}
                            </button>
                          </td>
                          <td style={styles.td}>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              <button
                                style={styles.grantBtn}
                                onClick={() => openGrantForUser(u.username)}
                                title="Grant free subscription or offer"
                              >
                                + Grant Plan
                              </button>
                              {active && (
                                <button
                                  style={styles.revokeBtn}
                                  onClick={() => handleRevoke(u.username, active.id)}
                                  title="Revoke active plan"
                                >
                                  Revoke
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Expanded Recharge / Order History Details */}
            {expandedUser && (
              <div style={styles.historyDrawer}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <h3 style={{ margin: 0, fontSize: 15, color: "#f8fafc" }}>
                    Recharge &amp; Subscription History for: <span style={{ color: "#38bdf8" }}>{expandedUser}</span>
                  </h3>
                  <button style={styles.closeDrawerBtn} onClick={() => setExpandedUser(null)}>
                    ✕ Close
                  </button>
                </div>

                {(() => {
                  const target = usersData.find((u) => u.username === expandedUser);
                  const orders = target?.recharges || [];
                  const subs = target?.subscriptions || [];

                  if (orders.length === 0 && subs.length === 0) {
                    return <p style={{ color: "#94a3b8", fontSize: 13 }}>No payment or subscription records found for this user.</p>;
                  }

                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      <div>
                        <strong style={{ fontSize: 12, color: "#cbd5e1", textTransform: "uppercase" }}>
                          Payment Orders ({orders.length})
                        </strong>
                        <div style={{ overflowX: "auto", marginTop: 6 }}>
                          <table style={styles.subTable}>
                            <thead>
                              <tr>
                                <th style={styles.subTh}>Order ID</th>
                                <th style={styles.subTh}>Plan</th>
                                <th style={styles.subTh}>Amount</th>
                                <th style={styles.subTh}>Status</th>
                                <th style={styles.subTh}>Date</th>
                                <th style={styles.subTh}>Reference</th>
                              </tr>
                            </thead>
                            <tbody>
                              {orders.map((o) => (
                                <tr key={o.order_id}>
                                  <td style={styles.subTd}>{o.order_id}</td>
                                  <td style={styles.subTd}>{o.plan_name}</td>
                                  <td style={styles.subTd}>₹{o.amount}</td>
                                  <td style={styles.subTd}>
                                    <span style={o.status === "verified" ? styles.verifiedBadge : styles.pendingBadge}>
                                      {o.status}
                                    </span>
                                  </td>
                                  <td style={styles.subTd}>{new Date(o.created_at * 1000).toLocaleString()}</td>
                                  <td style={styles.subTd}>{o.reference || "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div style={{ marginTop: 8 }}>
                        <strong style={{ fontSize: 12, color: "#cbd5e1", textTransform: "uppercase" }}>
                          Subscription Log ({subs.length})
                        </strong>
                        <div style={{ overflowX: "auto", marginTop: 6 }}>
                          <table style={styles.subTable}>
                            <thead>
                              <tr>
                                <th style={styles.subTh}>ID</th>
                                <th style={styles.subTh}>Plan</th>
                                <th style={styles.subTh}>Amount</th>
                                <th style={styles.subTh}>Status</th>
                                <th style={styles.subTh}>Calls</th>
                                <th style={styles.subTh}>Granted / Created</th>
                                <th style={styles.subTh}>Ref Note</th>
                              </tr>
                            </thead>
                            <tbody>
                              {subs.map((s) => (
                                <tr key={s.id}>
                                  <td style={styles.subTd}>#{s.id}</td>
                                  <td style={styles.subTd}>{s.plan_name}</td>
                                  <td style={styles.subTd}>₹{s.amount}</td>
                                  <td style={styles.subTd}>{s.status}</td>
                                  <td style={styles.subTd}>{s.call_limit ?? "1"} calls</td>
                                  <td style={styles.subTd}>{new Date(s.created_at * 1000).toLocaleDateString()}</td>
                                  <td style={styles.subTd}>{s.transaction_ref || "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </section>
        )}

        {/* TAB 2: GRANT SUBSCRIPTION / OFFERS */}
        {activeTab === "grant" && (
          <section style={styles.sectionCard}>
            <div style={styles.sectionHeader}>
              <div>
                <h2 style={styles.sectionTitle}>Grant Subscription / Special Offer (₹0)</h2>
                <p style={styles.sectionSubtitle}>
                  Instantly activate a plan or special offer for any user without requiring payment.
                </p>
              </div>
            </div>

            <form onSubmit={handleGrantSubmit} style={styles.grantForm}>
              <div style={styles.formRow}>
                <label style={styles.formLabel}>
                  Target User
                  <select
                    style={styles.formSelect}
                    value={grantUsername}
                    onChange={(e) => setGrantUsername(e.target.value)}
                    required
                  >
                    <option value="">-- Select a user --</option>
                    {usersData.map((u) => (
                      <option key={u.username} value={u.username}>
                        {u.username} ({u.email || "no email"})
                      </option>
                    ))}
                  </select>
                </label>

                <label style={styles.formLabel}>
                  Plan / Offer Type
                  <select
                    style={styles.formSelect}
                    value={grantPlanId}
                    onChange={(e) => {
                      const pid = e.target.value;
                      setGrantPlanId(pid);
                      if (pid === "monthly") {
                        setGrantPlanName("Monthly Pro");
                        setGrantCallLimit(30);
                        setGrantDurationDays(30);
                      } else if (pid === "hourly_call") {
                        setGrantPlanName("Interview Call");
                        setGrantCallLimit(1);
                        setGrantDurationMinutes(60);
                      } else {
                        setGrantPlanName("Special Campus Offer");
                        setGrantCallLimit(10);
                        setGrantDurationDays(30);
                      }
                    }}
                  >
                    <option value="monthly">Monthly Pro (30 Days · 30 Calls)</option>
                    <option value="hourly_call">Single Interview Call (1 Hour)</option>
                    <option value="custom_offer">Custom Promotional Offer</option>
                  </select>
                </label>
              </div>

              <div style={styles.formRow}>
                <label style={styles.formLabel}>
                  Display Plan Name
                  <input
                    type="text"
                    style={styles.formInput}
                    placeholder="e.g. Monthly Pro, Scholarship Offer"
                    value={grantPlanName}
                    onChange={(e) => setGrantPlanName(e.target.value)}
                  />
                </label>

                {grantPlanId === "monthly" || grantPlanId === "custom_offer" ? (
                  <>
                    <label style={styles.formLabel}>
                      Duration (Days)
                      <input
                        type="number"
                        min="1"
                        max="365"
                        style={styles.formInput}
                        value={grantDurationDays}
                        onChange={(e) => setGrantDurationDays(e.target.value)}
                        required
                      />
                    </label>
                    <label style={styles.formLabel}>
                      Total Calls Allowed
                      <input
                        type="number"
                        min="1"
                        max="500"
                        style={styles.formInput}
                        value={grantCallLimit}
                        onChange={(e) => setGrantCallLimit(e.target.value)}
                        required
                      />
                    </label>
                  </>
                ) : (
                  <label style={styles.formLabel}>
                    Call Duration (Minutes)
                    <input
                      type="number"
                      min="10"
                      max="300"
                      style={styles.formInput}
                      value={grantDurationMinutes}
                      onChange={(e) => setGrantDurationMinutes(e.target.value)}
                      required
                    />
                  </label>
                )}
              </div>

              <div style={styles.formRow}>
                <label style={{ ...styles.formLabel, flex: 1 }}>
                  Reason / Internal Note
                  <input
                    type="text"
                    style={styles.formInput}
                    placeholder="e.g. Student scholarship, Free pass, Manual UPI payment received"
                    value={grantReason}
                    onChange={(e) => setGrantReason(e.target.value)}
                  />
                </label>
              </div>

              <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 14 }}>
                <button type="submit" style={styles.submitGrantBtn} disabled={granting || !grantUsername}>
                  {granting ? "Granting Plan…" : "✓ Grant Subscription (₹0)"}
                </button>
                {grantMessage && <span style={{ color: "#4ade80", fontSize: 13 }}>{grantMessage}</span>}
                {grantError && <span style={{ color: "#f87171", fontSize: 13 }}>{grantError}</span>}
              </div>
            </form>
          </section>
        )}

        {/* TAB 3: PLAN PRICING & OFFERS */}
        {activeTab === "plans" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <AdminPlans />
          </div>
        )}

        {/* TAB 4: USER FEEDBACKS */}
        {activeTab === "feedback" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <AdminFeedback />
          </div>
        )}
      </main>
    </div>
  );
}

const styles = {
  container: { minHeight: "100vh", background: "#0b0f19", color: "#f8fafc", fontFamily: "system-ui, sans-serif" },
  navbar: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "14px 28px", background: "rgba(15, 23, 42, 0.8)", borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
    backdropFilter: "blur(12px)", position: "sticky", top: 0, zIndex: 50,
  },
  navBrand: { display: "flex", alignItems: "center", gap: 12 },
  logoBadge: {
    width: 38, height: 38, borderRadius: 10, background: "linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)",
    display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: "#fff", fontSize: 16,
    boxShadow: "0 0 16px rgba(79, 70, 229, 0.4)",
  },
  brandTitle: { margin: 0, fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em", color: "#f8fafc" },
  adminBadge: { fontSize: 11, fontWeight: 700, color: "#38bdf8", letterSpacing: "0.04em", textTransform: "uppercase" },
  navUser: { display: "flex", alignItems: "center", gap: 12 },
  userPill: {
    display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", borderRadius: 9999,
    background: "rgba(30, 41, 59, 0.7)", border: "1px solid rgba(255, 255, 255, 0.08)", fontSize: 13,
  },
  adminDot: { width: 8, height: 8, borderRadius: "50%", background: "#38bdf8", boxShadow: "0 0 8px #38bdf8" },
  userName: { fontWeight: 600, color: "#e2e8f0" },
  adminRoleTag: {
    fontSize: 10, fontWeight: 700, textTransform: "uppercase", padding: "2px 6px", borderRadius: 4,
    background: "rgba(56, 189, 248, 0.15)", color: "#38bdf8",
  },
  signOutBtn: {
    padding: "7px 14px", border: "1px solid rgba(255, 255, 255, 0.12)", borderRadius: 8,
    background: "rgba(255, 255, 255, 0.04)", color: "#cbd5e1", cursor: "pointer", fontSize: 12, fontWeight: 600,
  },
  main: { maxWidth: 1200, margin: "0 auto", padding: "28px 24px" },
  metricGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 24 },
  metricCard: {
    background: "rgba(30, 41, 59, 0.5)", border: "1px solid rgba(255, 255, 255, 0.06)",
    borderRadius: 12, padding: "16px 20px", display: "flex", flexDirection: "column", gap: 6,
  },
  metricLabel: { fontSize: 12, color: "#94a3b8", fontWeight: 500 },
  metricValue: { fontSize: 24, fontWeight: 800, color: "#f8fafc" },
  tabBar: { display: "flex", gap: 8, borderBottom: "1px solid rgba(255, 255, 255, 0.08)", paddingBottom: 12, marginBottom: 20, overflowX: "auto" },
  tabBtn: {
    padding: "9px 16px", borderRadius: 8, border: "1px solid rgba(255, 255, 255, 0.08)",
    background: "rgba(30, 41, 59, 0.4)", color: "#94a3b8", fontSize: 13, fontWeight: 600, cursor: "pointer",
  },
  tabBtnActive: {
    padding: "9px 16px", borderRadius: 8, border: "1px solid #4f46e5",
    background: "linear-gradient(135deg, rgba(79, 70, 229, 0.3) 0%, rgba(6, 182, 212, 0.2) 100%)",
    color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
  },
  sectionCard: {
    background: "rgba(30, 41, 59, 0.4)", border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: 14, padding: 22,
  },
  sectionHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 14, marginBottom: 18 },
  sectionTitle: { margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "#f8fafc" },
  sectionSubtitle: { margin: 0, fontSize: 13, color: "#94a3b8" },
  searchInput: {
    padding: "8px 14px", borderRadius: 8, border: "1px solid #475569", background: "#151b2b",
    color: "#fff", fontSize: 13, width: 220,
  },
  refreshBtn: {
    padding: "8px 14px", borderRadius: 8, border: 0, background: "#334155", color: "#fff",
    fontSize: 12, fontWeight: 600, cursor: "pointer",
  },
  tableWrapper: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", textAlign: "left" },
  th: { padding: "10px 14px", fontSize: 12, fontWeight: 700, color: "#94a3b8", borderBottom: "1px solid rgba(255, 255, 255, 0.08)", textTransform: "uppercase" },
  tr: { borderBottom: "1px solid rgba(255, 255, 255, 0.05)" },
  td: { padding: "12px 14px", fontSize: 13, color: "#e2e8f0", verticalAlign: "middle" },
  activeTag: {
    padding: "3px 8px", borderRadius: 9999, fontSize: 11, fontWeight: 700,
    background: "rgba(74, 222, 128, 0.15)", color: "#86efac", display: "inline-block",
  },
  inactiveTag: {
    padding: "3px 8px", borderRadius: 9999, fontSize: 11, fontWeight: 600,
    background: "rgba(148, 163, 184, 0.15)", color: "#94a3b8", display: "inline-block",
  },
  historyBtn: {
    padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(255, 255, 255, 0.12)",
    background: "rgba(255, 255, 255, 0.05)", color: "#cbd5e1", fontSize: 12, cursor: "pointer",
  },
  grantBtn: {
    padding: "5px 10px", borderRadius: 6, border: 0, background: "#4f46e5", color: "#fff",
    fontSize: 12, fontWeight: 600, cursor: "pointer",
  },
  revokeBtn: {
    padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(248, 113, 113, 0.3)",
    background: "rgba(248, 113, 113, 0.15)", color: "#fca5a5", fontSize: 12, cursor: "pointer",
  },
  historyDrawer: {
    marginTop: 18, padding: 18, borderRadius: 10, background: "#0f172a",
    border: "1px solid rgba(56, 189, 248, 0.2)",
  },
  closeDrawerBtn: {
    padding: "4px 8px", borderRadius: 6, border: 0, background: "#334155", color: "#cbd5e1",
    fontSize: 11, cursor: "pointer",
  },
  subTable: { width: "100%", borderCollapse: "collapse", fontSize: 12, textAlign: "left" },
  subTh: { padding: "6px 10px", borderBottom: "1px solid #334155", color: "#94a3b8" },
  subTd: { padding: "6px 10px", borderBottom: "1px solid rgba(255, 255, 255, 0.04)", color: "#e2e8f0" },
  verifiedBadge: { padding: "2px 6px", borderRadius: 4, background: "rgba(74, 222, 128, 0.15)", color: "#86efac", fontSize: 10, fontWeight: 700 },
  pendingBadge: { padding: "2px 6px", borderRadius: 4, background: "rgba(250, 204, 21, 0.15)", color: "#fde047", fontSize: 10, fontWeight: 700 },
  grantForm: { display: "flex", flexDirection: "column", gap: 14, maxWidth: 700 },
  formRow: { display: "flex", gap: 14, flexWrap: "wrap" },
  formLabel: { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#cbd5e1", flex: 1, minWidth: 200 },
  formSelect: {
    padding: "9px 12px", borderRadius: 8, border: "1px solid #475569", background: "#151b2b",
    color: "#fff", fontSize: 13,
  },
  formInput: {
    padding: "9px 12px", borderRadius: 8, border: "1px solid #475569", background: "#151b2b",
    color: "#fff", fontSize: 13,
  },
  submitGrantBtn: {
    padding: "10px 20px", borderRadius: 8, border: 0,
    background: "linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)", color: "#fff",
    fontSize: 13, fontWeight: 700, cursor: "pointer",
  },
  errorText: { color: "#f87171", fontSize: 13, margin: "0 0 12px" },
};
