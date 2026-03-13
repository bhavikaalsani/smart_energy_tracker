import { useEffect, useMemo, useState } from "react";
import { Line } from "react-chartjs-2";
import {
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import {
  clearToken,
  createMeterReading,
  deleteMeterReading,
  extractReadingFromImage,
  fetchMeterReadings,
  getToken,
  loginUser,
  registerUser,
  setTokens,
  updateMeterReading,
} from "./api";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend
);

const initialForm = {
  reading_date: "",
  reading_value: "",
  cost_per_unit: "",
};

const monthLabelFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});

function formatMonthKey(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) {
    return monthKey;
  }
  return monthLabelFormatter.format(new Date(year, month - 1, 1));
}

function App() {
  const [readings, setReadings] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [formData, setFormData] = useState(initialForm);
  const [authForm, setAuthForm] = useState({
    username: "",
    password: "",
  });
  const [authMode, setAuthMode] = useState("login");
  const [isAuthenticated, setIsAuthenticated] = useState(Boolean(getToken()));
  const [authLoading, setAuthLoading] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrText, setOcrText] = useState("");
  const [error, setError] = useState("");

  const sortedReadings = useMemo(
    () =>
      [...readings].sort(
        (a, b) => new Date(a.reading_date).getTime() - new Date(b.reading_date).getTime()
      ),
    [readings]
  );

  const filteredReadings = useMemo(
    () =>
      sortedReadings.filter((item) => {
        if (fromDate && item.reading_date < fromDate) {
          return false;
        }
        if (toDate && item.reading_date > toDate) {
          return false;
        }
        return true;
      }),
    [fromDate, toDate, sortedReadings]
  );

  const readingsByMonth = useMemo(
    () =>
      sortedReadings.reduce((acc, item) => {
        const monthKey = item.reading_date.slice(0, 7);
        if (!acc[monthKey]) {
          acc[monthKey] = [];
        }
        acc[monthKey].push(item);
        return acc;
      }, {}),
    [sortedReadings]
  );

  const monthOptions = useMemo(
    () =>
      Object.keys(readingsByMonth)
        .sort((a, b) => (a < b ? 1 : -1))
        .map((key) => ({
          key,
          label: formatMonthKey(key),
        })),
    [readingsByMonth]
  );

  useEffect(() => {
    if (monthOptions.length === 0) {
      setSelectedMonth("");
      return;
    }

    const monthStillAvailable = monthOptions.some(
      (option) => option.key === selectedMonth
    );
    if (!monthStillAvailable) {
      setSelectedMonth(monthOptions[0].key);
    }
  }, [monthOptions, selectedMonth]);

  const monthlyReadings = useMemo(
    () => (selectedMonth ? readingsByMonth[selectedMonth] || [] : []),
    [selectedMonth, readingsByMonth]
  );

  const monthlySummary = useMemo(() => {
    const totalUnits = monthlyReadings.reduce(
      (sum, item) => sum + Number(item.units_consumed),
      0
    );
    const totalAmount = monthlyReadings.reduce(
      (sum, item) => sum + Number(item.amount),
      0
    );
    const avgCostPerUnit =
      totalUnits > 0 ? (totalAmount / totalUnits).toFixed(2) : "0.00";

    return {
      totalUnits: totalUnits.toFixed(2),
      totalAmount: totalAmount.toFixed(2),
      avgCostPerUnit,
    };
  }, [monthlyReadings]);

  const summary = useMemo(() => {
    const totalUnits = filteredReadings.reduce(
      (sum, item) => sum + Number(item.units_consumed),
      0
    );
    const totalAmount = filteredReadings.reduce(
      (sum, item) => sum + Number(item.amount),
      0
    );
    const avgCostPerUnit =
      totalUnits > 0 ? (totalAmount / totalUnits).toFixed(2) : "0.00";

    return {
      totalUnits: totalUnits.toFixed(2),
      totalAmount: totalAmount.toFixed(2),
      avgCostPerUnit,
    };
  }, [filteredReadings]);

  const unitsChartData = useMemo(
    () => ({
      labels: filteredReadings.map((item) => item.reading_date),
      datasets: [
        {
          label: "Units Consumed",
          data: filteredReadings.map((item) => item.units_consumed),
          borderColor: "#1665d8",
          backgroundColor: "rgba(22, 101, 216, 0.2)",
          tension: 0.3,
        },
      ],
    }),
    [filteredReadings]
  );

  const amountChartData = useMemo(
    () => ({
      labels: filteredReadings.map((item) => item.reading_date),
      datasets: [
        {
          label: "Expense Amount",
          data: filteredReadings.map((item) => item.amount),
          borderColor: "#0c8b4d",
          backgroundColor: "rgba(12, 139, 77, 0.2)",
          tension: 0.3,
        },
      ],
    }),
    [filteredReadings]
  );

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
  };

  const loadReadings = async () => {
    setLoading(true);
    try {
      const result = await fetchMeterReadings();
      setReadings(result);
      setError("");
    } catch (err) {
      if (err.message.toLowerCase().includes("credentials")) {
        clearToken();
        setIsAuthenticated(false);
      }
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      loadReadings();
    } else {
      setReadings([]);
      setLoading(false);
    }
  }, [isAuthenticated]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleAuthChange = (event) => {
    const { name, value } = event.target;
    setAuthForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleAuthSubmit = async (event) => {
    event.preventDefault();
    setAuthLoading(true);

    try {
      if (authMode === "register") {
        await registerUser(authForm);
      }
      const tokenData = await loginUser(authForm.username, authForm.password);
      setTokens(tokenData.access_token, tokenData.refresh_token);
      setIsAuthenticated(true);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    clearToken();
    setIsAuthenticated(false);
    setAuthForm({ username: "", password: "" });
    setError("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);

    try {
      await createMeterReading({
        reading_date: formData.reading_date,
        reading_value: Number(formData.reading_value),
        cost_per_unit: Number(formData.cost_per_unit),
      });
      setFormData(initialForm);
      await loadReadings();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleOcrFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setOcrLoading(true);
    try {
      const result = await extractReadingFromImage(file);
      setFormData((prev) => ({
        ...prev,
        reading_value: String(result.reading_value),
      }));
      setOcrText(result.extracted_text || "");
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setOcrLoading(false);
      event.target.value = "";
    }
  };

  const handleExportCsv = () => {
    if (filteredReadings.length === 0) {
      setError("No data available for export.");
      return;
    }

    const header = [
      "id",
      "reading_date",
      "reading_value",
      "units_consumed",
      "cost_per_unit",
      "amount",
      "created_at",
    ];

    const rows = filteredReadings.map((item) => [
      item.id,
      item.reading_date,
      item.reading_value,
      item.units_consumed,
      item.cost_per_unit,
      item.amount,
      item.created_at,
    ]);

    const csvContent = [header, ...rows]
      .map((row) => row.map((value) => `"${String(value ?? "")}"`).join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "meter_readings_export.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleEditReading = async (item) => {
    const readingDateInput = window.prompt("Reading date (YYYY-MM-DD):", item.reading_date);
    if (!readingDateInput) {
      return;
    }

    const readingValueInput = window.prompt(
      "Current meter value:",
      String(item.reading_value)
    );
    if (readingValueInput === null || readingValueInput.trim() === "") {
      return;
    }

    const costPerUnitInput = window.prompt(
      "Cost per unit:",
      String(item.cost_per_unit)
    );
    if (costPerUnitInput === null || costPerUnitInput.trim() === "") {
      return;
    }

    try {
      await updateMeterReading(item.id, {
        reading_date: readingDateInput,
        reading_value: Number(readingValueInput),
        cost_per_unit: Number(costPerUnitInput),
      });
      setError("");
      await loadReadings();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteReading = async (item) => {
    const confirmed = window.confirm(
      `Delete reading for ${item.reading_date}? This cannot be undone.`
    );
    if (!confirmed) {
      return;
    }

    try {
      await deleteMeterReading(item.id);
      setError("");
      await loadReadings();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <main className="container">
      <div className="page-header">
        <h1>Smart Electricity Meter Expense Tracker</h1>
        {isAuthenticated ? (
          <button type="button" onClick={handleLogout}>
            Logout
          </button>
        ) : null}
      </div>

      {!isAuthenticated ? (
        <section className="card">
          <h2>{authMode === "login" ? "Login" : "Create Account"}</h2>
          {error ? <p className="error">{error}</p> : null}
          <form className="form auth-form" onSubmit={handleAuthSubmit}>
            <label>
              Username
              <input
                type="text"
                name="username"
                value={authForm.username}
                onChange={handleAuthChange}
                minLength={3}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                name="password"
                value={authForm.password}
                onChange={handleAuthChange}
                minLength={6}
                required
              />
            </label>
            <button type="submit" disabled={authLoading}>
              {authLoading
                ? "Please wait..."
                : authMode === "login"
                  ? "Login"
                  : "Register and Login"}
            </button>
            <button
              type="button"
              onClick={() =>
                setAuthMode((prev) => (prev === "login" ? "register" : "login"))
              }
            >
              {authMode === "login"
                ? "Need an account? Register"
                : "Already have an account? Login"}
            </button>
          </form>
        </section>
      ) : null}

      {isAuthenticated ? (
        <>

      <section className="card">
        <h2>Add Meter Reading</h2>
        <div className="ocr-box">
          <label>
            Upload Meter Image (OCR)
            <input type="file" accept="image/*" onChange={handleOcrFileChange} />
          </label>
          {ocrLoading ? <p>Extracting reading from image...</p> : null}
          {ocrText ? <p className="ocr-text">Detected text: {ocrText}</p> : null}
        </div>
        <form className="form" onSubmit={handleSubmit}>
          <label>
            Reading Date
            <input
              type="date"
              name="reading_date"
              value={formData.reading_date}
              onChange={handleChange}
              required
            />
          </label>

          <label>
            Current Meter Value
            <input
              type="number"
              name="reading_value"
              value={formData.reading_value}
              onChange={handleChange}
              min="0"
              step="0.01"
              required
            />
          </label>

          <label>
            Cost Per Unit
            <input
              type="number"
              name="cost_per_unit"
              value={formData.cost_per_unit}
              onChange={handleChange}
              min="0"
              step="0.01"
              required
            />
          </label>

          <button type="submit" disabled={submitting}>
            {submitting ? "Saving..." : "Save Reading"}
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Summary</h2>
        <div className="summary-grid">
          <div className="summary-item">
            <p className="summary-label">Total Units</p>
            <p className="summary-value">{summary.totalUnits}</p>
          </div>
          <div className="summary-item">
            <p className="summary-label">Total Expense</p>
            <p className="summary-value">{summary.totalAmount}</p>
          </div>
          <div className="summary-item">
            <p className="summary-label">Avg Cost / Unit</p>
            <p className="summary-value">{summary.avgCostPerUnit}</p>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Filter by Date</h2>
        <div className="filters-row">
          <label>
            From
            <input
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              setFromDate("");
              setToDate("");
            }}
          >
            Clear Filter
          </button>
          <button type="button" onClick={handleExportCsv}>
            Export CSV
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Reading History</h2>
        {error ? <p className="error">{error}</p> : null}
        {loading ? (
          <p>Loading...</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Reading</th>
                <th>Units Consumed</th>
                <th>Cost/Unit</th>
                <th>Amount</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredReadings.map((item) => (
                <tr key={item.id}>
                  <td>{item.reading_date}</td>
                  <td>{item.reading_value}</td>
                  <td>{item.units_consumed}</td>
                  <td>{item.cost_per_unit}</td>
                  <td>{item.amount}</td>
                  <td>
                    <div className="actions-cell">
                      <button type="button" onClick={() => handleEditReading(item)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="danger-button"
                        onClick={() => handleDeleteReading(item)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Monthly Readings</h2>
        {monthOptions.length === 0 ? (
          <p>Add readings to view monthly history.</p>
        ) : (
          <>
            <div className="month-picker">
              <label>
                Select Month
                <select
                  value={selectedMonth}
                  onChange={(event) => setSelectedMonth(event.target.value)}
                >
                  {monthOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="summary-grid">
              <div className="summary-item">
                <p className="summary-label">Monthly Units</p>
                <p className="summary-value">{monthlySummary.totalUnits}</p>
              </div>
              <div className="summary-item">
                <p className="summary-label">Monthly Expense</p>
                <p className="summary-value">{monthlySummary.totalAmount}</p>
              </div>
              <div className="summary-item">
                <p className="summary-label">Avg Cost / Unit</p>
                <p className="summary-value">{monthlySummary.avgCostPerUnit}</p>
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Reading</th>
                  <th>Units Consumed</th>
                  <th>Cost/Unit</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {monthlyReadings.map((item) => (
                  <tr key={item.id}>
                    <td>{item.reading_date}</td>
                    <td>{item.reading_value}</td>
                    <td>{item.units_consumed}</td>
                    <td>{item.cost_per_unit}</td>
                    <td>{item.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section className="card">
        <h2>Usage and Expense Trends</h2>
        {filteredReadings.length < 2 ? (
          <p>Add at least 2 readings to view trend charts.</p>
        ) : (
          <div className="charts-grid">
            <div className="chart-box">
              <Line data={unitsChartData} options={chartOptions} />
            </div>
            <div className="chart-box">
              <Line data={amountChartData} options={chartOptions} />
            </div>
          </div>
        )}
      </section>
        </>
      ) : null}
    </main>
  );
}

export default App;
