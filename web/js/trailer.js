// AniList trailers. Only a YouTube trailer with a well-formed video id gets through: letters, digits, "-" and "_",
// so the id is safe as-is in a URL path, a query string, an attribute and a CSS url(). Anything else gives ''.
const YOUTUBE_ID = /^[A-Za-z0-9_-]{6,20}$/;

export const youtubeId = trailer =>
  trailer?.site === 'youtube' && typeof trailer.id === 'string' && YOUTUBE_ID.test(trailer.id) ? trailer.id : '';
