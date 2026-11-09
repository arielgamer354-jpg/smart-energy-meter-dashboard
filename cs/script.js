
"use strict";

/*
 * ==========================================================
 * SMART ENERGY METER
 * ESP32 + PZEM-004T + FIREBASE REALTIME DATABASE
 * ==========================================================
 *
 * PLATFORM:
 * - Firebase Authentication
 * - Firebase Realtime Database
 * - Bootstrap 5
 * - Chart.js
 *
 * PARAMETERS:
 * - Voltage : 2 decimal places
 * - Current : 3 decimal places
 * - Power   : 2 decimal places
 * - Energy  : 3 decimal places (kWh)
 *
 * DATABASE:
 * /sensor
 * /history
 * /setting/batas
 *
 * ==========================================================
 */


// ==========================================================
// 1. FIREBASE CONFIGURATION
// ==========================================================

const firebaseConfig = {
    apiKey: "AIzaSyBKWpeSnxZ5NfcveYvYRhZB8oCdW6hCPBw",
    authDomain: "smart-energy-meter-bff7d.firebaseapp.com",
    databaseURL:
        "https://smart-energy-meter-bff7d-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "smart-energy-meter-bff7d"
};


// ==========================================================
// 2. FIREBASE INITIALIZATION
// ==========================================================

if (typeof firebase === "undefined") {
    throw new Error("Firebase SDK belum dimuat.");
}

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const db = firebase.database();
const auth = firebase.auth();


// ==========================================================
// 3. GLOBAL VARIABLES
// ==========================================================

// Authentication
let currentUser = null;
let dashboardStarted = false;

// Chart instances
let powerChart = null;
let voltageChart = null;
let currentChart = null;
let monitorPowerChart = null;
let energyChart = null;

// Sensor values
let currentVoltage = 0;
let currentCurrent = 0;
let currentPower = 0;
let currentEnergy = 0;

// Energy from ESP32/PZEM is assumed to be Wh.
let activeLimit = 900;

// Last sensor update
let lastSensorUpdate = 0;

// Chart configuration
const MAX_POINTS = 30;
const MAX_STATISTIC_SAMPLES = 100;

// Data collections
let powerData = [];
let historyData = [];

// Firebase listeners
let dashboardListeners = [];

// Timers
let clockInterval = null;
let statusInterval = null;


// ==========================================================
// 4. PARAMETER PRECISION CONFIGURATION
// ==========================================================

const PRECISION = {
    voltage: 2,
    current: 3,
    power: 2,
    energy: 3
};


// ==========================================================
// 5. GENERAL HELPER FUNCTIONS
// ==========================================================

function getElement(id) {
    return document.getElementById(id);
}


// Convert value to a valid number.
function toNumber(value, fallback = 0) {
    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return fallback;
    }

    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}


// General number formatter.
function formatNumber(value, decimals = 2) {
    return toNumber(value).toFixed(decimals);
}


// Voltage formatter.
function formatVoltage(value) {
    return formatNumber(value, PRECISION.voltage);
}


// Current formatter: THREE decimal places.
function formatCurrent(value) {
    return formatNumber(value, PRECISION.current);
}


// Power formatter.
function formatPower(value) {
    return formatNumber(value, PRECISION.power);
}


// Convert Wh to kWh.
function toKwh(energyWh) {
    return toNumber(energyWh) / 1000;
}


// Energy formatter.
function formatKwh(energyWh) {
    return toKwh(energyWh).toFixed(PRECISION.energy);
}


// Update HTML text.
function setText(id, value) {
    const element = getElement(id);

    if (element) {
        element.textContent = value;
    }
}


// Update Bootstrap badge.
function setBadge(id, text, className) {
    const element = getElement(id);

    if (!element) return;

    element.textContent = text;
    element.className = "badge " + className;
}


// Escape HTML when constructing text-based markup.
function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


// ==========================================================
// 6. FIREBASE AUTHENTICATION STATE
// ==========================================================

auth.onAuthStateChanged(function(user) {

    currentUser = user;

    const loginPage = getElement("loginPage");
    const appContent = getElement("appContent");
    const userEmail = getElement("firebaseUserEmail");

    if (user) {

        // Show application.
        if (loginPage) {
            loginPage.classList.add("d-none");
        }

        if (appContent) {
            appContent.classList.remove("d-none");
        }

        // Display logged-in email.
        if (userEmail) {
            userEmail.textContent = user.email || "";
        }

        console.log(
            "Firebase login berhasil:",
            user.email
        );

        startDashboard();

    } else {

        // Hide application.
        if (appContent) {
            appContent.classList.add("d-none");
        }

        if (loginPage) {
            loginPage.classList.remove("d-none");
        }

        if (userEmail) {
            userEmail.textContent = "";
        }

        // Stop all dashboard processes.
        stopDashboard();

        console.log(
            "Belum ada pengguna yang login."
        );
    }
});


// ==========================================================
// 7. LOGIN FORM
// ==========================================================

const loginForm = getElement("loginForm");

if (loginForm) {

    loginForm.addEventListener(
        "submit",
        async function(event) {

            event.preventDefault();

            const email =
                getElement("loginEmail")?.value.trim();

            const password =
                getElement("loginPassword")?.value;

            const loginButton =
                getElement("loginButton");

            const loginError =
                getElement("loginError");

            if (loginError) {
                loginError.textContent = "";
                loginError.classList.add("d-none");
            }

            if (!email || !password) {
                showLoginError(
                    "Email dan password wajib diisi."
                );

                return;
            }

            try {

                if (loginButton) {
                    loginButton.disabled = true;

                    loginButton.innerHTML =
                        '<span class="spinner-border spinner-border-sm me-2"></span>' +
                        "Memproses...";
                }

                await auth.signInWithEmailAndPassword(
                    email,
                    password
                );

            } catch (error) {

                console.error(
                    "Firebase Login Error:",
                    error
                );

                showLoginError(
                    getLoginErrorMessage(error)
                );

            } finally {

                if (loginButton) {
                    loginButton.disabled = false;

                    loginButton.innerHTML =
                        '<i class="bi bi-box-arrow-in-right"></i> Login';
                }
            }
        }
    );
}


// ==========================================================
// 8. LOGIN ERROR HANDLING
// ==========================================================

function showLoginError(message) {

    const loginError = getElement("loginError");

    if (!loginError) return;

    loginError.textContent = message;

    loginError.classList.remove("d-none");
}


function getLoginErrorMessage(error) {

    switch (error.code) {

        case "auth/invalid-email":
            return "Format email tidak valid.";

        case "auth/user-disabled":
            return "Akun Firebase ini dinonaktifkan.";

        case "auth/user-not-found":
        case "auth/wrong-password":
        case "auth/invalid-login-credentials":
            return "Email atau password salah.";

        case "auth/too-many-requests":
            return "Terlalu banyak percobaan login. Coba lagi nanti.";

        case "auth/network-request-failed":
            return "Koneksi internet bermasalah.";

        default:
            return "Login gagal. Periksa email, password, dan koneksi internet.";
    }
}


// ==========================================================
// 9. SHOW / HIDE PASSWORD
// ==========================================================

const togglePassword = getElement("togglePassword");

if (togglePassword) {

    togglePassword.addEventListener(
        "click",
        function() {

            const password =
                getElement("loginPassword");

            const icon =
                togglePassword.querySelector("i");

            if (!password || !icon) return;

            if (password.type === "password") {

                password.type = "text";

                icon.className = "bi bi-eye-slash";

            } else {

                password.type = "password";

                icon.className = "bi bi-eye";
            }
        }
    );
}


// ==========================================================
// 10. LOGOUT
// ==========================================================

async function logout() {

    try {

        await auth.signOut();

        console.log("Logout berhasil.");

    } catch (error) {

        console.error(
            "Firebase Logout Error:",
            error
        );

        alert(
            "Logout gagal. Silakan coba lagi."
        );
    }
}

window.logout = logout;


// ==========================================================
// 11. START DASHBOARD
// ==========================================================

function startDashboard() {

    if (dashboardStarted) return;

    dashboardStarted = true;

    initializeDashboard();
}


// ==========================================================
// 12. STOP DASHBOARD
// ==========================================================

function stopDashboard() {

    if (!dashboardStarted) return;

    // Remove Firebase listeners.
    dashboardListeners.forEach(function(listener) {

        listener.ref.off(
            listener.event,
            listener.callback
        );

    });

    dashboardListeners = [];

    // Stop clock.
    if (clockInterval !== null) {

        clearInterval(clockInterval);

        clockInterval = null;
    }

    // Stop status monitoring.
    if (statusInterval !== null) {

        clearInterval(statusInterval);

        statusInterval = null;
    }

    // Destroy chart instances.
    [
        powerChart,
        voltageChart,
        currentChart,
        monitorPowerChart,
        energyChart
    ].forEach(function(chart) {

        if (chart) {
            chart.destroy();
        }
    });

    powerChart = null;
    voltageChart = null;
    currentChart = null;
    monitorPowerChart = null;
    energyChart = null;

    // Reset dashboard data.
    powerData = [];
    historyData = [];

    currentVoltage = 0;
    currentCurrent = 0;
    currentPower = 0;
    currentEnergy = 0;

    lastSensorUpdate = 0;

    dashboardStarted = false;
}


// ==========================================================
// 13. DASHBOARD INITIALIZATION
// ==========================================================

function initializeDashboard() {

    // ------------------------------------------------------
    // CHART DATA
    // ------------------------------------------------------

    const chartLabels = [];

    const voltageValues = [];
    const currentValues = [];
    const powerValues = [];
    const energyValues = [];


    // ======================================================
    // 14. PAGE NAVIGATION
    // ======================================================

    window.showPage = function(pageId) {

        if (!currentUser) return;

        document.querySelectorAll(".page").forEach(
            function(page) {
                page.classList.add("d-none");
            }
        );

        const target = getElement(pageId);

        if (target) {
            target.classList.remove("d-none");
        }

        // Update active navigation.
        document.querySelectorAll(
            ".navbar .nav-link"
        ).forEach(function(link) {

            link.classList.remove("active");

            const handler =
                link.getAttribute("onclick") || "";

            if (handler.includes("'" + pageId + "'")) {
                link.classList.add("active");
            }
        });

        // Close mobile navigation.
        const navbarMenu = getElement("navbarMenu");

        if (
            navbarMenu &&
            navbarMenu.classList.contains("show") &&
            typeof bootstrap !== "undefined"
        ) {

            const collapse =
                bootstrap.Collapse.getOrCreateInstance(
                    navbarMenu
                );

            collapse.hide();
        }

        // Resize chart after page transition.
        setTimeout(resizeCharts, 150);
    };


    // ======================================================
    // 15. DATE AND TIME
    // ======================================================

    function updateClock() {

        const now = new Date();

        setText(
            "tanggal",
            now.toLocaleDateString("id-ID", {
                day: "2-digit",
                month: "long",
                year: "numeric"
            })
        );

        setText(
            "jam",
            now.toLocaleTimeString("id-ID")
        );
    }

    updateClock();

    clockInterval = setInterval(
        updateClock,
        1000
    );


    // ======================================================
    // 16. CHART OPTIONS
    // ======================================================

    function chartOptions(yTitle, decimals = 2) {

        return {

            responsive: true,

            maintainAspectRatio: false,

            animation: false,

            interaction: {
                intersect: false,
                mode: "index"
            },

            plugins: {

                legend: {
                    display: true,
                    position: "top"
                },

                tooltip: {

                    enabled: true,

                    callbacks: {

                        label: function(context) {

                            const value =
                                toNumber(context.parsed.y);

                            return (
                                context.dataset.label +
                                ": " +
                                value.toFixed(decimals)
                            );
                        }
                    }
                }
            },

            scales: {

                x: {

                    title: {
                        display: true,
                        text: "Waktu"
                    },

                    ticks: {
                        maxTicksLimit: 8,
                        maxRotation: 0
                    }
                },

                y: {

                    beginAtZero: true,

                    title: {
                        display: true,
                        text: yTitle
                    },

                    ticks: {

                        callback: function(value) {

                            return toNumber(value)
                                .toFixed(decimals);
                        }
                    }
                }
            }
        };
    }


    // ======================================================
    // 17. CREATE LINE CHART
    // ======================================================

    function createLineChart(
        canvasId,
        label,
        dataArray,
        yTitle,
        decimals = 2,
        fill = false
    ) {

        const canvas = getElement(canvasId);

        if (!canvas || typeof Chart === "undefined") {

            console.warn(
                "Canvas atau Chart.js tidak tersedia:",
                canvasId
            );

            return null;
        }

        return new Chart(canvas, {

            type: "line",

            data: {

                labels: chartLabels,

                datasets: [{

                    label: label,

                    data: dataArray,

                    borderWidth: 2.5,

                    pointRadius: 2,

                    pointHoverRadius: 5,

                    tension: 0.3,

                    fill: fill
                }]
            },

            options: chartOptions(
                yTitle,
                decimals
            )
        });
    }


    // ======================================================
    // 18. CREATE ALL CHARTS
    // ======================================================

    function createCharts() {

        // Power chart.
        powerChart = createLineChart(
            "powerChart",
            "Daya (W)",
            powerValues,
            "Daya (W)",
            PRECISION.power,
            true
        );

        // Voltage chart.
        voltageChart = createLineChart(
            "voltageChart",
            "Tegangan (V)",
            voltageValues,
            "Tegangan (V)",
            PRECISION.voltage
        );

        // Current chart: THREE DECIMAL PLACES.
        currentChart = createLineChart(
            "currentChart",
            "Arus (A)",
            currentValues,
            "Arus (A)",
            PRECISION.current
        );

        // Monitoring power chart.
        monitorPowerChart = createLineChart(
            "monitorPowerChart",
            "Daya (W)",
            powerValues,
            "Daya (W)",
            PRECISION.power
        );

        // Energy chart.
        energyChart = createLineChart(
            "energyChart",
            "Energi (kWh)",
            energyValues,
            "Energi (kWh)",
            PRECISION.energy
        );
    }

    createCharts();


    // ======================================================
    // 19. UPDATE CHARTS
    // ======================================================

    function updateCharts() {

        [
            powerChart,
            voltageChart,
            currentChart,
            monitorPowerChart,
            energyChart
        ].forEach(function(chart) {

            if (chart) {
                chart.update("none");
            }
        });
    }


    // ======================================================
    // 20. RESIZE CHARTS
    // ======================================================

    function resizeCharts() {

        [
            powerChart,
            voltageChart,
            currentChart,
            monitorPowerChart,
            energyChart
        ].forEach(function(chart) {

            if (chart) {
                chart.resize();
            }
        });
    }


    // ======================================================
    // 21. REGISTER FIREBASE LISTENER
    // ======================================================

    function listen(ref, event, callback, errorCallback) {

        ref.on(
            event,
            callback,
            errorCallback || function(error) {

                console.error(
                    "Firebase listener error:",
                    error
                );
            }
        );

        dashboardListeners.push({

            ref: ref,

            event: event,

            callback: callback
        });
    }


    // ======================================================
    // 22. FIREBASE CONNECTION STATUS
    // ======================================================

    listen(
        db.ref(".info/connected"),
        "value",
        function(snapshot) {

            const connected =
                snapshot.val() === true;

            if (connected) {

                setBadge(
                    "statusFirebase",
                    "Firebase Connected",
                    "bg-success"
                );

                setBadge(
                    "firebaseStatus",
                    "Online",
                    "bg-success"
                );

            } else {

                setBadge(
                    "statusFirebase",
                    "Disconnected",
                    "bg-danger"
                );

                setBadge(
                    "firebaseStatus",
                    "Offline",
                    "bg-danger"
                );
            }
        }
    );


    // ======================================================
    // 23. SENSOR DATA FROM FIREBASE
    // ======================================================

    listen(
        db.ref("sensor"),
        "value",
        function(snapshot) {

            const data = snapshot.val();

            if (
                !data ||
                typeof data !== "object"
            ) {

                console.warn(
                    "Data sensor belum tersedia."
                );

                return;
            }


            // ------------------------------------------------
            // READ SENSOR VALUES
            // ------------------------------------------------

            currentVoltage = toNumber(data.voltage);

            currentCurrent = toNumber(data.current);

            currentPower = toNumber(data.power);

            // Energy from ESP32/PZEM is assumed to be Wh.
            currentEnergy = toNumber(data.energy);

            lastSensorUpdate = Date.now();


            // ------------------------------------------------
            // DASHBOARD DISPLAY
            // ------------------------------------------------

            setText(
                "voltage",
                formatVoltage(currentVoltage)
            );

            // CURRENT: THREE DECIMAL PLACES.
            setText(
                "current",
                formatCurrent(currentCurrent)
            );

            setText(
                "power",
                formatPower(currentPower)
            );

            setText(
                "energy",
                formatKwh(currentEnergy)
            );


            // ------------------------------------------------
            // MONITORING DISPLAY
            // ------------------------------------------------

            setText(
                "monitorVoltage",
                formatVoltage(currentVoltage)
            );

            // CURRENT: THREE DECIMAL PLACES.
            setText(
                "monitorCurrent",
                formatCurrent(currentCurrent)
            );

            setText(
                "monitorPower",
                formatPower(currentPower)
            );

            setText(
                "monitorEnergy",
                formatKwh(currentEnergy)
            );


            // ------------------------------------------------
            // UPDATE CHART DATA
            // ------------------------------------------------

            const time =
                new Date().toLocaleTimeString("id-ID");

            chartLabels.push(time);

            voltageValues.push(currentVoltage);

            currentValues.push(currentCurrent);

            powerValues.push(currentPower);

            energyValues.push(
                toKwh(currentEnergy)
            );


            // ------------------------------------------------
            // LIMIT CHART DATA
            // ------------------------------------------------

            if (chartLabels.length > MAX_POINTS) {

                chartLabels.shift();

                voltageValues.shift();

                currentValues.shift();

                powerValues.shift();

                energyValues.shift();
            }


            // ------------------------------------------------
            // POWER STATISTICS
            // ------------------------------------------------

            powerData.push(currentPower);

            if (
                powerData.length >
                MAX_STATISTIC_SAMPLES
            ) {

                powerData.shift();
            }


            // ------------------------------------------------
            // UPDATE SYSTEM INFORMATION
            // ------------------------------------------------

            updateStatistics();

            updateDeviceStatus();

            updateAlert();

            updateCharts();
        }
    );


    // ======================================================
    // 24. DEVICE STATUS
    // ======================================================

    function updateDeviceStatus() {

        const online =
            lastSensorUpdate > 0 &&
            (Date.now() - lastSensorUpdate) < 10000;

        if (online) {

            setBadge(
                "espStatus",
                "Online",
                "bg-success"
            );

            setBadge(
                "pzemStatus",
                "Online",
                "bg-success"
            );

        } else {

            setBadge(
                "espStatus",
                "Offline",
                "bg-danger"
            );

            setBadge(
                "pzemStatus",
                "Periksa Data",
                "bg-warning text-dark"
            );
        }

        setText(
            "lastUpdate",

            lastSensorUpdate > 0
                ? new Date(
                    lastSensorUpdate
                ).toLocaleTimeString("id-ID")
                : "-"
        );
    }

    statusInterval = setInterval(
        updateDeviceStatus,
        2000
    );


    // ======================================================
    // 25. POWER STATISTICS
    // ======================================================

    function updateStatistics() {

        if (powerData.length === 0) return;

        const sum = powerData.reduce(
            function(total, value) {
                return total + value;
            },
            0
        );

        const average =
            sum / powerData.length;

        const maximum =
            Math.max(...powerData);

        const minimum =
            Math.min(...powerData);

        setText(
            "avgPower",
            formatPower(average)
        );

        setText(
            "maxPower",
            formatPower(maximum)
        );

        setText(
            "minPower",
            formatPower(minimum)
        );

        setText(
            "sampleCount",
            String(powerData.length)
        );
    }


    // ======================================================
    // 26. POWER LIMIT SETTINGS
    // ======================================================

    listen(
        db.ref("setting/batas"),
        "value",
        function(snapshot) {

            if (!snapshot.exists()) return;

            activeLimit = toNumber(
                snapshot.val(),
                900
            );

            setText(
                "batasAktif",
                formatNumber(activeLimit, 0)
            );

            setText(
                "alertLimit",
                formatNumber(activeLimit, 0)
            );

            const inputBatas =
                getElement("inputBatas");

            if (
                inputBatas &&
                document.activeElement !== inputBatas
            ) {

                inputBatas.value = activeLimit;
            }

            updateAlert();
        }
    );


    // ======================================================
    // 27. SAVE POWER LIMIT
    // ======================================================

    window.simpanBatas = async function() {

        const input = getElement("inputBatas");

        if (!input) return;

        const batas = Number(input.value);

        if (
            input.value.trim() === "" ||
            !Number.isFinite(batas) ||
            batas < 0
        ) {

            alert(
                "Masukkan batas daya yang valid."
            );

            return;
        }

        try {

            await db.ref("setting/batas").set(batas);

            alert(
                "Pengaturan berhasil disimpan."
            );

        } catch (error) {

            console.error(
                "Gagal menyimpan batas daya:",
                error
            );

            alert(
                "Pengaturan gagal disimpan. Periksa koneksi dan izin Firebase."
            );
        }
    };


    // ======================================================
    // 28. ALERT / NOTIFICATION
    // ======================================================

    function updateAlert() {

        const overLimit =
            currentPower > activeLimit;

        const alertBox =
            getElement("alertBox");

        const dashboardAlert =
            getElement("dashboardAlert");

        // ----------------------------------------------
        // ALERT ELEMENTS
        // ----------------------------------------------

        setText(
            "alertLimit",
            formatNumber(activeLimit, 0)
        );


        // ----------------------------------------------
        // POWER EXCEEDS LIMIT
        // ----------------------------------------------

        if (overLimit) {

            if (alertBox) {
                alertBox.className =
                    "alert alert-danger";
            }

            setText(
                "alertTitle",
                "Peringatan Batas Daya"
            );

            setText(
                "alertMessage",

                "Daya saat ini " +
                    formatPower(currentPower) +
                    " W, melebihi batas " +
                    formatNumber(activeLimit, 2) +
                    " W."
            );

            if (dashboardAlert) {

                dashboardAlert.classList.remove(
                    "d-none"
                );

                dashboardAlert.className =
                    "alert alert-danger mt-4";
            }

            setText(
                "dashboardAlertTitle",
                "Peringatan Batas Daya"
            );

            setText(
                "dashboardAlertText",

                "Daya saat ini " +
                    formatPower(currentPower) +
                    " W melebihi batas " +
                    formatNumber(activeLimit, 2) +
                    " W."
            );

        } else {

            // ------------------------------------------
            // NORMAL CONDITION
            // ------------------------------------------

            if (alertBox) {
                alertBox.className =
                    "alert alert-success";
            }

            setText(
                "alertTitle",
                "Kondisi Normal"
            );

            setText(
                "alertMessage",
                "Konsumsi daya berada di bawah batas yang ditentukan."
            );

            if (dashboardAlert) {
                dashboardAlert.classList.add(
                    "d-none"
                );
            }
        }
    }


    // ======================================================
    // 29. HISTORY DATA
    // ======================================================

    listen(
        db.ref("history"),
        "value",
        function(snapshot) {

            const table =
                getElement("historyTable");

            if (!table) return;

            table.innerHTML = "";

            historyData = [];

            if (!snapshot.exists()) {

                table.innerHTML = `
                    <tr>
                        <td colspan="5" class="text-muted">
                            Belum ada data riwayat.
                        </td>
                    </tr>
                `;

                return;
            }


            // ----------------------------------------------
            // READ HISTORY
            // ----------------------------------------------

            snapshot.forEach(function(item) {

                const value = item.val();

                if (
                    !value ||
                    typeof value !== "object"
                ) {
                    return;
                }

                const timestamp =
                    value.timestamp ?? item.key ?? "";

                const voltage =
                    toNumber(value.voltage);

                const current =
                    toNumber(value.current);

                const power =
                    toNumber(value.power);

                // Energy in history is assumed to be Wh.
                const energyKwh =
                    toKwh(value.energy);


                // ------------------------------------------
                // SAVE HISTORY OBJECT
                // ------------------------------------------

                const historyItem = {

                    timestamp: timestamp,

                    voltage: voltage,

                    current: current,

                    power: power,

                    energyKwh: energyKwh
                };

                historyData.push(historyItem);


                // ------------------------------------------
                // CREATE TABLE ROW
                // ------------------------------------------

                const row =
                    document.createElement("tr");

                const dateText =
                    formatHistoryDate(timestamp);

                const cells = [

                    dateText,

                    formatVoltage(voltage),

                    // CURRENT: THREE DECIMAL PLACES.
                    formatCurrent(current),

                    formatPower(power),

                    energyKwh.toFixed(
                        PRECISION.energy
                    )
                ];

                cells.forEach(function(cellValue) {

                    const cell =
                        document.createElement("td");

                    cell.textContent = cellValue;

                    row.appendChild(cell);
                });

                table.appendChild(row);
            });


            // ----------------------------------------------
            // EMPTY HISTORY CHECK
            // ----------------------------------------------

            if (historyData.length === 0) {

                table.innerHTML = `
                    <tr>
                        <td colspan="5" class="text-muted">
                            Belum ada data riwayat.
                        </td>
                    </tr>
                `;
            }
        }
    );


    // ======================================================
    // 30. FORMAT HISTORY DATE
    // ======================================================

    function formatHistoryDate(timestamp) {

        if (
            timestamp === null ||
            timestamp === undefined ||
            timestamp === ""
        ) {
            return "-";
        }

        // Support timestamp in milliseconds or seconds.
        if (
            typeof timestamp === "number" ||
            /^\d{10,13}$/.test(String(timestamp))
        ) {

            let numericTimestamp =
                Number(timestamp);

            // Ten-digit timestamp is usually seconds.
            if (
                String(timestamp).length === 10
            ) {
                numericTimestamp *= 1000;
            }

            const dateFromNumber =
                new Date(numericTimestamp);

            if (
                !Number.isNaN(
                    dateFromNumber.getTime()
                )
            ) {

                return dateFromNumber.toLocaleString(
                    "id-ID"
                );
            }
        }

        const date = new Date(timestamp);

        if (!Number.isNaN(date.getTime())) {

            return date.toLocaleString("id-ID");
        }

        return String(timestamp);
    }


    // ======================================================
    // 31. EXPORT HISTORY CSV
    // ======================================================

    window.exportHistoryCSV = function() {

        if (historyData.length === 0) {

            alert(
                "Belum ada data riwayat untuk diekspor."
            );

            return;
        }

        const rows = [

            [
                "Waktu",
                "Tegangan (V)",
                "Arus (A)",
                "Daya (W)",
                "Energi (kWh)"
            ]
        ];


        // ----------------------------------------------
        // CONVERT HISTORY TO CSV
        // ----------------------------------------------

        historyData.forEach(function(item) {

            rows.push([

                item.timestamp,

                formatVoltage(item.voltage),

                // CURRENT: THREE DECIMAL PLACES.
                formatCurrent(item.current),

                formatPower(item.power),

                item.energyKwh.toFixed(
                    PRECISION.energy
                )
            ]);
        });


        // ----------------------------------------------
        // CREATE CSV STRING
        // ----------------------------------------------

        const csv = rows.map(function(row) {

            return row.map(function(value) {

                return '"' +
                    String(value ?? "")
                        .replace(/"/g, '""') +
                    '"';

            }).join(",");

        }).join("\r\n");


        // ----------------------------------------------
        // DOWNLOAD CSV
        // ----------------------------------------------

        const blob = new Blob(

            ["\uFEFF", csv],

            {
                type: "text/csv;charset=utf-8;"
            }
        );

        const url =
            URL.createObjectURL(blob);

        const link =
            document.createElement("a");

        link.href = url;

        link.download =
            "riwayat-smart-energy-meter.csv";

        document.body.appendChild(link);

        link.click();

        link.remove();

        setTimeout(function() {

            URL.revokeObjectURL(url);

        }, 1000);
    };


    // ======================================================
    // 32. INITIAL PAGE
    // ======================================================

    window.showPage("dashboardPage");


    // ======================================================
    // 33. INITIAL CHART RESIZE
    // ======================================================

    setTimeout(
        resizeCharts,
        300
    );


    console.log(
        "Smart Energy Meter Dashboard berhasil diinisialisasi."
    );
}


// ==========================================================
// END OF SMART ENERGY METER JAVASCRIPT
// ==========================================================
