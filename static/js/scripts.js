document.addEventListener('DOMContentLoaded', function () {
  const map = L.map('map').setView([20, 0], 2);
  const stationList = document.getElementById('station-list');
  const stationSearch = document.getElementById('station-search');
  const clearSearch = document.getElementById('clear-search');
  const stationCount = document.getElementById('station-count');
  const stationName = document.getElementById('station-name');
  const audioPlayer = document.getElementById('audio-player');

  let stations = [];
  let filteredStations = [];
  let activeStationId = null;
  let autoRetryCount = 0;

  const markers = new Map();

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function updateCount() {
    stationCount.textContent = filteredStations.length + ' stations';
  }

  function highlightActiveStation() {
    const items = stationList.querySelectorAll('.station-item');
    items.forEach(item => {
      const id = Number(item.dataset.id);
      item.classList.toggle('active', id === activeStationId);
    });
  }

  function playStation(station, source) {
    autoRetryCount = 0;
    activeStationId = station.id;
    stationName.textContent = station.name + ' | ' + source;
    audioPlayer.src = station.stream_url;
    audioPlayer.play().catch(() => {
      stationName.textContent = station.name + ' | Press play to start audio';
    });
    highlightActiveStation();
  }

  function renderStationList() {
    if (filteredStations.length === 0) {
      stationList.innerHTML = '<li class="empty-state">No matching stations found.</li>';
      updateCount();
      return;
    }

    const listMarkup = filteredStations
      .map(station => {
        return `
          <li>
            <button class="station-item" data-id="${station.id}">
              <span class="station-name">${escapeHtml(station.name)}</span>
            </button>
          </li>
        `;
      })
      .join('');

    stationList.innerHTML = listMarkup;
    highlightActiveStation();
    updateCount();
  }

  function applyFilter() {
    const query = stationSearch.value.trim().toLowerCase();
    filteredStations = stations.filter(station => station.name.toLowerCase().includes(query));
    renderStationList();
  }

  function findNextStation() {
    if (stations.length === 0) {
      return null;
    }

    const currentIndex = stations.findIndex(station => station.id === activeStationId);
    for (let offset = 1; offset <= stations.length; offset += 1) {
      const nextIndex = (currentIndex + offset + stations.length) % stations.length;
      const candidate = stations[nextIndex];
      if (candidate && candidate.id !== activeStationId) {
        return candidate;
      }
    }

    return null;
  }

  fetch('/api/radio_stations')
    .then(response => response.json())
    .then(data => {
      stations = data
        .map((station, index) => ({
          id: index,
          name: station.name,
          latitude: Number(station.latitude),
          longitude: Number(station.longitude),
          stream_url: station.stream_url
        }))
        .filter(station => !Number.isNaN(station.latitude) && !Number.isNaN(station.longitude) && station.stream_url);

      filteredStations = [...stations];
      renderStationList();

      stations.forEach(station => {
        const marker = L.marker([station.latitude, station.longitude]).addTo(map);
        marker.bindPopup(`
          <strong>${escapeHtml(station.name)}</strong><br>
          <button class="popup-btn" data-id="${station.id}" type="button">Listen</button>
        `);

        marker.on('click', function () {
          activeStationId = station.id;
          highlightActiveStation();
        });

        markers.set(station.id, marker);
      });
    })
    .catch(() => {
      stationList.innerHTML = '<li class="empty-state">Unable to load stations right now.</li>';
    });

  stationList.addEventListener('click', function (event) {
    const button = event.target.closest('.station-item');
    if (!button) {
      return;
    }

    const stationId = Number(button.dataset.id);
    const station = stations.find(item => item.id === stationId);
    if (!station) {
      return;
    }

    const marker = markers.get(station.id);
    if (marker) {
      map.flyTo([station.latitude, station.longitude], 5, { duration: 0.8 });
      marker.openPopup();
    }

    playStation(station, 'Station List');
  });

  map.on('popupopen', function (event) {
    const playButton = event.popup.getElement().querySelector('.popup-btn');
    if (!playButton) {
      return;
    }

    playButton.addEventListener('click', function () {
      const stationId = Number(playButton.dataset.id);
      const station = stations.find(item => item.id === stationId);
      if (!station) {
        return;
      }
      playStation(station, 'Map Popup');
    });
  });

  stationSearch.addEventListener('input', applyFilter);

  clearSearch.addEventListener('click', function () {
    stationSearch.value = '';
    applyFilter();
    stationSearch.focus();
  });

  audioPlayer.addEventListener('error', function () {
    const failedStation = stations.find(station => station.id === activeStationId);
    if (!failedStation) {
      stationName.textContent = 'Stream error. Please choose another station.';
      return;
    }

    if (autoRetryCount >= 2) {
      stationName.textContent = failedStation.name + ' | Stream unavailable, choose another station';
      return;
    }

    autoRetryCount += 1;
    const nextStation = findNextStation();
    if (!nextStation) {
      stationName.textContent = failedStation.name + ' | Stream unavailable, no backup station found';
      return;
    }

    stationName.textContent = failedStation.name + ' failed. Trying ' + nextStation.name + '...';
    activeStationId = nextStation.id;
    highlightActiveStation();
    audioPlayer.src = nextStation.stream_url;
    audioPlayer.play().catch(() => {
      stationName.textContent = nextStation.name + ' | Press play to start audio';
    });
  });
});
  