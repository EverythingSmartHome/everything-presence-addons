import { useEffect, useState } from 'react';

const getQueryMatch = (query: string): boolean => (
  typeof window !== 'undefined' && window.matchMedia(query).matches
);

export const useMediaQuery = (query: string, initialValue = false): boolean => {
  const [matches, setMatches] = useState(() => (
    typeof window === 'undefined' ? initialValue : getQueryMatch(query)
  ));

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const mediaQueryList = window.matchMedia(query);
    const handleChange = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };

    setMatches(mediaQueryList.matches);
    mediaQueryList.addEventListener('change', handleChange);

    return () => {
      mediaQueryList.removeEventListener('change', handleChange);
    };
  }, [query]);

  return matches;
};

export const useIsMobileCanvas = () => useMediaQuery('(max-width: 767px)');
