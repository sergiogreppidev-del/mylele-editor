import type { ButtonHTMLAttributes } from 'react';

type Tone = 'grape' | 'sun' | 'melon' | 'lime' | 'sky' | 'ghost';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: Tone;
  small?: boolean;
}

/** El botón caramelo: firma visual de MyLele. */
export function CandyButton({ tone = 'grape', small, className = '', ...rest }: Props) {
  const classes = ['cbtn'];
  if (tone !== 'grape') classes.push(tone);
  if (small) classes.push('sm');
  if (className) classes.push(className);
  return <button type="button" {...rest} className={classes.join(' ')} />;
}
