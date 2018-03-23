const FULL_UPDATE_INTERVAL_MINS = 1;

/**
 * BadgeTicker class: Refreshes the badge on the icon every minute and monitors timer state on the server.
 */
class BadgeTicker {
    /**
     * Initializes the ticker.
     */
    static init () {
        /**
         * Controls the offset in seconds between us and the server (timezone diff + any excess roundtrip/ping time).
         *
         * @type {number}
         */
        this.timeOffset = 0;

        /**
         * Holds the latest timer data received from the server.
         */
        this.timerState = {
            /**
             * @var {bool}
             */
            started: false,
            /**
             * @var {Number|null}
             */
            started_at: null,
            /**
             * @var {Object}
             */
            active_task: null,
            /**
             * @var {Number|null}
             */
            seconds_active: null,
            /**
             * @var {Number}
             */
            now: (Date.now() / 1000)
        };

        /**
         * @type {boolean}
         */
        this.badgeSecondUpdatesEnabled = false;

        // Network config
        axios.defaults.baseURL = 'https://timetrakt.com/api/';

        // Begin interval ticking
        setInterval(() => {
            this.tickFullUpdate();
        }, 1000 * 60 * FULL_UPDATE_INTERVAL_MINS);

        setInterval(() => {
            this.tickUiUpdate();
        }, 1000);

        // Immediate update
        this.tickFullUpdate();

        // Listen for messages from the popup
        chrome.extension.onConnect.addListener((port) => {
            port.onMessage.addListener((msg) => {
                console.debug('[ChromeNet]', '(Incoming message)', msg);

                if (msg === "hello") {
                    // Pop up opened, do UI update
                    this.tickUiUpdate();
                } else if (msg === "start") {
                    // Start timer
                    TraktApi.postTimerStateUpdate({
                        started: true
                    }).then((newState) => {
                        this.handleTimerState(newState);
                    }).catch((err) => {
                        console.error('[TimerAction]', '(Error: start)', err);
                    }).then(() => {
                        this.tickUiUpdate();
                    });
                } else if (msg === "delete") {
                    // Stop timer, delete activity
                    TraktApi.postTimerStateUpdate({
                        started: false
                    }).then((newState) => {
                        this.handleTimerState(newState);
                    }).catch((err) => {
                        console.error('[TimerAction]', '(Error: delete)', err);
                    }).then(() => {
                        this.tickUiUpdate();
                    });
                } else if (msg === "save") {
                    // Stop timer, delete activity
                    TraktApi.postTimerStateUpdate({
                        finish: true
                    }).then((newState) => {
                        this.handleTimerState(newState);
                    }).catch((err) => {
                        console.error('[TimerAction]', '(Error: save)', err);
                    }).then(() => {
                        this.tickUiUpdate();
                    });
                }
            });
        })
    }

    /**
     * Processes the timer state.
     *
     * @param {Object} timerState Remote data from server.
     * @param {Object} updateParcel Variable to be set with next badge data.
     */
    static handleTimerState(timerState, updateParcel) {
        this.timerState = timerState;

        // Determine time offset between us and the server
        let ourUnix = Date.now() / 1000;
        let theirUnix = timerState.now;

        this.timeOffset = theirUnix - ourUnix;

        console.debug('[Timer]', 'Time sync, diff between us and server:', this.timeOffset);

        if (updateParcel) {
            // Update badge
            this.setUpdateObjTexts(updateParcel);
        }
    }

    /**
     * Prepares text & tooltip for extension badge.
     *
     * @param {Object} updateParcel Variable to be set with next badge data.
     */
    static setUpdateObjTexts(updateParcel) {
        if (!this.timerState.started) {
            // Timer stopped
            updateParcel.text = "";
            updateParcel.tooltip = "Stopped";
            return;
        }

        if (this.timerState.active_task) {
            // Active task selected
            updateParcel.tooltip = this.timerState.active_task.name;
        } else {
            // No task but timer active (?)
            updateParcel.tooltip = "No active task";
        }

        // Show timer active time
        let clockText = this.getTimerClockFaceText();

        updateParcel.text = clockText.short;
        updateParcel.textFull = clockText.full;

        if (updateParcel.tooltip) {
            updateParcel.tooltip += "\r\n";
        }

        updateParcel.tooltip += clockText.full;
    }

    /**
     * Gets the timer face value (e.g. "1:01" for 1 hour and 1 minute)
     */
    static getTimerClockFaceText() {
        if (!this.timerState.started) {
            return "";
        }

        // Calculate current unix ts with server offset correction
        let nowUnix = Date.now() / 1000;
        nowUnix += this.timeOffset;

        // Calculate diff (total run time)
        let thenUnix = this.timerState.started_at;
        let totalSecondsActive = Math.round(nowUnix - thenUnix);

        // Format nicely
        let totalMinutes = Math.floor(totalSecondsActive / 60);
        let totalHours = Math.floor(totalMinutes / 60);

        let displayHours = totalHours;
        let displayMinutes = (totalMinutes - (totalHours * 60));
        let displaySeconds = Math.round(totalSecondsActive - (((totalHours * 60) + displayMinutes) * 60));

        displayHours    = displayHours.toString();
        displayMinutes  = displayMinutes.toString();
        displaySeconds  = displaySeconds.toString();

        if (displayMinutes.length === 1) { displayMinutes = `0${displayMinutes}`; }
        if (displaySeconds.length === 1) { displaySeconds = `0${displaySeconds}`; }

        let strHoursMins = `${displayHours}:${displayMinutes}`;
        let strHoursMinsSecs = `${strHoursMins}:${displaySeconds}`;

        return {
            "short": strHoursMins,
            "full": strHoursMinsSecs
        };
    }

    /**
     * Update the popup UI.
     */
    static updatePopupUi(updateParcel) {
        let views = chrome.extension.getViews({
            type: "popup"
        });

        let fnSetText = (doc, selectors, value) => {
            selectors = (selectors.constructor === Array) ? selectors : [selectors.toString()];

            for (let i = 0; i < selectors.length; i++) {
                let selector = selectors[i];
                let els = doc.getElementsByClassName(`TXT--${selector}`);

                for (let j = 0; j < els.length; j++) {
                    let el = els[j];
                    el.textContent = value || "";
                }
            }
        };

        let fnToggleVis = (doc, selectors, on) => {
            selectors = (selectors.constructor === Array) ? selectors : [selectors.toString()];

            for (let i = 0; i < selectors.length; i++) {
                let selector = selectors[i];
                let els = doc.getElementsByClassName(`TOG--${selector}`);

                for (let j = 0; j < els.length; j++) {
                    let el = els[j];
                    el.style.display = (on ? "flex" : "none");
                }
            }
        };

        for (let i = 0; i < views.length; i++) {
            let doc = views[i].document;

            if (this.timerState.started) {
                fnSetText(doc, "FACE", updateParcel.textFull);

                fnToggleVis(doc, ["BTN-SAVE", "BTN-DELETE"], true);
                fnToggleVis(doc, ["BTN-START"], false);
            } else {
                fnSetText(doc, "FACE", "Stopped");

                fnToggleVis(doc, ["BTN-SAVE", "BTN-DELETE"], false);
                fnToggleVis(doc, ["BTN-START"], true);
            }

            if (this.timerState.active_task) {
                fnSetText(doc, "TASK", this.timerState.active_task.name);
                fnSetText(doc, "PROJECT", this.timerState.active_task.project.name);
            } else {
                fnSetText(doc, ["TASK", "PROJECT"]);
                fnToggleVis(doc, ["BTN-SAVE"], false);
            }
        }
    }

    /**
     * Event handler that should be called every second.
     * Causes badge update only.
     */
    static tickUiUpdate() {
        // Fill badge data
        let updateParcel = {
            text: "",
            color: "#d352ad",
            tooltip: ""
        };

        this.setUpdateObjTexts(updateParcel);

        // Apply to UI
        if (this.badgeSecondUpdatesEnabled) {
            this.applyBadgeConfig(updateParcel);
        }

        this.updatePopupUi(updateParcel);
    }

    /**
     * Event handler that should be called every minute.
     * Causes status fetch and badge update.
     */
    static tickFullUpdate() {
        let updateParcel = {
            text: "",
            color: "#d352ad",
            tooltip: ""
        };

        this.refreshState()
            .then((timerState) => {
                console.debug('[Net]', '(API status result)', timerState);

                this.handleTimerState(timerState, updateParcel);
                this.badgeSecondUpdatesEnabled = true;
            })
            .catch((err) => {
                console.warn('[Net]', '(API status fetch failed)', err);

                updateParcel.text = "!";
                updateParcel.color = "#e74c3c";
                updateParcel.tooltip = "Communication error";

                this.badgeSecondUpdatesEnabled = false;
            })
            .then(() => {
                this.applyBadgeConfig(updateParcel);
            });
    }

    /**
     * Calls chrome APIs to reconfigure extension badge.
     *
     * @param {Object} updateParcel
     */
    static applyBadgeConfig(updateParcel) {
        chrome.browserAction.setBadgeText({
            text: updateParcel.text || ""
        });

        chrome.browserAction.setBadgeBackgroundColor({
            color: updateParcel.color || "#d352ad"
        });

        if (updateParcel.tooltip) {
            chrome.browserAction.setTitle({
                title: `Timetrakt - ${updateParcel.tooltip}`
            });
        } else {
            chrome.browserAction.setTitle({
                title: "Timetrakt"
            });
        }
    }

    /**
     * Fetches timer state from the server.
     *
     * @return {Promise<Object>}
     */
    static refreshState() {
        return TraktApi.getTimerState();
    }
}

class TraktApi {
    static getTimerState() {
        return new Promise((resolve, reject) => {
            axios.get('/v1/timer')
                .then((res) => {
                    resolve(res.data);
                })
                .catch((err) => {
                    reject(err);
                })
        });
    }

    static postTimerStateUpdate(timerUpdateParcel) {
        timerUpdateParcel = Object.assign({ }, BadgeTicker.timerState, timerUpdateParcel || { });

        console.debug('[API]', '(Post timer update)', 'Merged state for POST:', timerUpdateParcel);

        return new Promise((resolve, reject) => {
            axios.post('/v1/timer', timerUpdateParcel)
                .then((res) => {
                    resolve(res.data);
                })
                .catch((err) => {
                    reject(err);
                })
        });
    }
}

BadgeTicker.init();