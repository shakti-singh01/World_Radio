from flask import Flask, render_template, jsonify
import pandas as pd
import json
import time
import os
from urllib.parse import urlencode
from urllib.request import Request, urlopen

app = Flask(__name__)

# Load radio stations data
data = pd.read_csv('data/radio_stations.csv')
fallback_stations = data.to_dict(orient='records')

RADIO_BROWSER_BASES = [
    'https://de1.api.radio-browser.info/json/stations/search',
    'https://fr1.api.radio-browser.info/json/stations/search',
    'https://nl1.api.radio-browser.info/json/stations/search',
]

station_cache = {
    'expires_at': 0,
    'stations': []
}


def _to_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def fetch_live_stations(limit=100):
    params = urlencode({
        'hidebroken': 'true',
        'is_https': 'true',
        'order': 'votes',
        'reverse': 'true',
        'limit': limit
    })

    for base_url in RADIO_BROWSER_BASES:
        try:
            request = Request(
                f'{base_url}?{params}',
                headers={'User-Agent': 'MyRadioSite/1.0'}
            )
            with urlopen(request, timeout=8) as response:
                payload = json.loads(response.read().decode('utf-8'))

            stations = []
            seen_urls = set()

            for item in payload:
                stream_url = (item.get('url_resolved') or item.get('url') or '').strip()
                codec = (item.get('codec') or '').lower()
                lat = _to_float(item.get('geo_lat') or item.get('latitude'))
                lon = _to_float(item.get('geo_long') or item.get('longitude'))

                if not stream_url.startswith('http'):
                    continue
                if stream_url in seen_urls:
                    continue
                if codec and ('mp3' not in codec and 'aac' not in codec):
                    continue
                if lat is None or lon is None:
                    continue

                name = (item.get('name') or item.get('stationuuid') or 'Unnamed Station').strip()
                if not name:
                    name = 'Unnamed Station'

                seen_urls.add(stream_url)
                stations.append({
                    'name': name,
                    'latitude': lat,
                    'longitude': lon,
                    'stream_url': stream_url
                })

            if len(stations) >= 20:
                return stations
        except Exception:
            continue

    return []


def get_served_stations():
    now = time.time()
    if station_cache['stations'] and now < station_cache['expires_at']:
        return station_cache['stations']

    live_stations = fetch_live_stations(limit=140)
    if live_stations:
        station_cache['stations'] = live_stations
        station_cache['expires_at'] = now + 60 * 10
        return live_stations

    # Fallback to local CSV data if live discovery fails.
    station_cache['stations'] = fallback_stations
    station_cache['expires_at'] = now + 60 * 2
    return fallback_stations


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/radio_stations')
def radio_stations():
    stations = get_served_stations()
    return jsonify(stations)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)