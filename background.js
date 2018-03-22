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
        this.secondUpdatesEnabled = false;

        // Network config
        axios.defaults.baseURL = 'https://timetrakt.com/api/';

        // Begin interval ticking
        setInterval(() => {
            this.tickFullUpdate();
        }, 1000 * 60 * FULL_UPDATE_INTERVAL_MINS);

        setInterval(() => {
            if (this.secondUpdatesEnabled) {
                this.tickUiUpdate();
            }
        }, 1000);

        // Immediate update
        this.tickFullUpdate();
    }

    /**
     * Processes the timer state.
     *
     * @param {Object} timerState Remote data from server.
     * @param {Object} outNextBadge Variable to be set with next badge data.
     */
    static handleTimerState(timerState, outNextBadge) {
        this.timerState = timerState;

        // Determine time offset between us and the server
        let ourUnix = Date.now() / 1000;
        let theirUnix = timerState.now;

        this.timeOffset = theirUnix - ourUnix;

        console.debug('[Timer]', 'Time sync, diff between us and server:', this.timeOffset);

        // Update badge
        this.getBadgeTextAndTooltip(outNextBadge);
    }

    /**
     * Prepares text & tooltip for extension badge.
     *
     * @param {Object} outNextBadge Variable to be set with next badge data.
     */
    static getBadgeTextAndTooltip(outNextBadge) {
        if (!this.timerState.started) {
            // Timer stopped
            outNextBadge.text = "";
            outNextBadge.tooltip = "Stopped";
            return;
        }

        if (this.timerState.active_task) {
            // Active task selected
            outNextBadge.tooltip = this.timerState.active_task.name;
        } else {
            // No task but timer active (?)
            outNextBadge.tooltip = "No active task";
        }

        // Show timer active time
        let clockText = this.getTimerClockFaceText();

        outNextBadge.text = clockText.short;

        if (outNextBadge.tooltip) {
            outNextBadge.tooltip += "\r\n";
        }

        outNextBadge.tooltip += clockText.full;
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
     * Event handler that should be called every second.
     * Causes badge update only.
     */
    static tickUiUpdate() {
        if (!this.secondUpdatesEnabled) {
            return;
        }

        let nextBadge = {
            text: "",
            color: "#d352ad",
            tooltip: ""
        };

        this.getBadgeTextAndTooltip(nextBadge);
        this.applyBadgeConfig(nextBadge);
    }

    /**
     * Event handler that should be called every minute.
     * Causes status fetch and badge update.
     */
    static tickFullUpdate() {
        let nextBadge = {
            text: "",
            color: "#d352ad",
            tooltip: ""
        };

        this.refreshState()
            .then((timerState) => {
                console.debug('[Net]', '(API status result)', timerState);

                this.handleTimerState(timerState, nextBadge);
                this.secondUpdatesEnabled = true;
            })
            .catch((err) => {
                console.warn('[Net]', '(API status fetch failed)', err);

                nextBadge.text = "!";
                nextBadge.color = "#e74c3c";
                nextBadge.tooltip = "Communication error";

                this.secondUpdatesEnabled = false;
            })
            .then(() => {
                this.applyBadgeConfig(nextBadge);
            });
    }

    /**
     * Calls chrome APIs to reconfigure extension badge.
     *
     * @param {Object} nextBadge
     */
    static applyBadgeConfig(nextBadge) {
        if (!this.lastBadge) {
            this.lastBadge = { };
        }

        nextBadge = Object.assign({}, this.lastBadge, nextBadge)

        chrome.browserAction.setBadgeText({
            text: nextBadge.text || "Timetrakt"
        });

        chrome.browserAction.setBadgeBackgroundColor({
            color: nextBadge.color || "#d352ad"
        });

        if (nextBadge.tooltip) {
            chrome.browserAction.setTitle({
                title: `Timetrakt - ${nextBadge.tooltip}`
            });
        } else {
            chrome.browserAction.setTitle({
                title: "Timetrakt"
            });
        }

        this.lastBadge = nextBadge;
    }

    /**
     * Fetches timer state from the server.
     *
     * @return {Promise<Object>}
     */
    static refreshState() {
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
}

BadgeTicker.init();