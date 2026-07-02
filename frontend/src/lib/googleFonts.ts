export const POPULAR_GOOGLE_FONTS = [
  'Roboto', 'Inter', 'Open Sans', 'Montserrat', 'Lato', 'Poppins', 'Oswald',
  'Source Sans Pro', 'Raleway', 'Ubuntu', 'Merriweather', 'Playfair Display',
  'Nunito', 'PT Sans', 'Rubik', 'Noto Sans', 'Work Sans', 'Lora', 'Fira Sans',
  'Mukta', 'Quicksand', 'Karla', 'Barlow', 'Inconsolata', 'Titillium Web',
  'PT Serif', 'DM Sans', 'Heebo', 'Hind', 'Josefin Sans', 'Space Grotesk',
  'Bebas Neue', 'Anton', 'Outfit', 'Manrope', 'Cabin', 'Varela Round',
  'Asap', 'Zilla Slab', 'Arimo', 'Bitter', 'Crimson Text', 'Exo 2',
  'Dosis', 'Archivo', 'Teko', 'Fjalla One', 'Cairo', 'Caveat', 'Pacifico',
  'Righteous', 'Permanent Marker', 'Alfa Slab One', 'Patua One', 'Cinzel',
  'Crete Round', 'Rokkitt', 'Vollkorn', 'Bree Serif', 'Play', 'Abril Fatface',
  'Courgette', 'Concert One', 'Lobster', 'Satisfy', 'Amatic SC', 'Dancing Script',
  'Great Vibes', 'Sacramento', 'Yellowtail', 'Berkshire Swash', 'Chewy', 'Bangers',
  'Fredoka One', 'Carter One', 'Baloo 2', 'Lilita One', 'Modak', 'Creepster',
  'Nosifer', 'Press Start 2P', 'VT323', 'Silkscreen', 'Changa One', 'Passion One'
].sort();

export function loadGoogleFont(fontFamily: string) {
  if (typeof window === 'undefined') return;
  if (!fontFamily) return;

  const id = `font-${fontFamily.replace(/\s+/g, '-').toLowerCase()}`;
  if (document.getElementById(id)) return;

  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${fontFamily.replace(/\s+/g, '+')}:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,700&display=swap`;
  document.head.appendChild(link);
}
