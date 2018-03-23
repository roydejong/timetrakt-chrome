let bgPort = chrome.runtime.connect();
bgPort.postMessage("hello");

let btnStart = document.getElementById('btn-start');
let btnSave = document.getElementById('btn-save');
let btnDelete = document.getElementById('btn-delete');

btnStart.onclick = (e) => {
    bgPort.postMessage("start");
};

btnSave.onclick = (e) => {
    bgPort.postMessage("save");
};

btnDelete.onclick = (e) => {
    bgPort.postMessage("delete");
};
