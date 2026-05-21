const path = require('path');
const { audioRoot } = require('../config');

// Demo seed rows. They become playable only if the matching MP3 exists in apps/api/audio.
const seedTracks = [
  {
    id: '3f7d7a38-1d75-4d8f-a9c8-8171a2d725e1',
    song_title: 'Chaiyya Chaiyya',
    movie_album: 'Dil Se',
    artists: ['Sukhwinder Singh', 'Sapna Awasthi'],
    full_audio_url: path.join(audioRoot, 'chaiyya-chaiyya.mp3'),
    snippet_start_time: 45,
    provider: 'manual',
    provider_track_id: '',
    artist_ids: [],
    isrc: '',
    artwork_url: '',
    source: 'seed'
  },
  {
    id: '8dbbb16a-b4d7-4b15-b2d5-a72d51582f6f',
    song_title: 'Tum Hi Ho',
    movie_album: 'Aashiqui 2',
    artists: ['Arijit Singh'],
    full_audio_url: path.join(audioRoot, 'tum-hi-ho.mp3'),
    snippet_start_time: 52,
    provider: 'manual',
    provider_track_id: '',
    artist_ids: [],
    isrc: '',
    artwork_url: '',
    source: 'seed'
  },
  {
    id: '048d00ea-bf14-43ce-8b73-f11f0cf1cf29',
    song_title: 'Kal Ho Naa Ho',
    movie_album: 'Kal Ho Naa Ho',
    artists: ['Sonu Nigam'],
    full_audio_url: path.join(audioRoot, 'kal-ho-naa-ho.mp3'),
    snippet_start_time: 63,
    provider: 'manual',
    provider_track_id: '',
    artist_ids: [],
    isrc: '',
    artwork_url: '',
    source: 'seed'
  },
  {
    id: '53c3b915-372f-4449-b03d-8b28cd942fd7',
    song_title: 'Kabira',
    movie_album: 'Yeh Jawaani Hai Deewani',
    artists: ['Tochi Raina', 'Rekha Bhardwaj'],
    full_audio_url: path.join(audioRoot, 'kabira.mp3'),
    snippet_start_time: 39,
    provider: 'manual',
    provider_track_id: '',
    artist_ids: [],
    isrc: '',
    artwork_url: '',
    source: 'seed'
  },
  {
    id: '36a5aca5-b4c1-418d-87b0-55425651f10e',
    song_title: 'Badtameez Dil',
    movie_album: 'Yeh Jawaani Hai Deewani',
    artists: ['Benny Dayal', 'Shefali Alvares'],
    full_audio_url: path.join(audioRoot, 'badtameez-dil.mp3'),
    snippet_start_time: 33,
    provider: 'manual',
    provider_track_id: '',
    artist_ids: [],
    isrc: '',
    artwork_url: '',
    source: 'seed'
  },
  {
    id: 'e92a0bf8-592a-4633-9be9-499188134c42',
    song_title: 'Tere Bina',
    movie_album: 'Guru',
    artists: ['A. R. Rahman', 'Chinmayi', 'Murtuza Khan', 'Qadir Khan'],
    full_audio_url: path.join(audioRoot, 'tere-bina.mp3'),
    snippet_start_time: 48,
    provider: 'manual',
    provider_track_id: '',
    artist_ids: [],
    isrc: '',
    artwork_url: '',
    source: 'seed'
  }
];

module.exports = {
  seedTracks
};
