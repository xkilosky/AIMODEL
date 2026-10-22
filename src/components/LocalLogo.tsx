import React from 'react';

interface LocalLogoProps {
  size?: number;
  className?: string;
}

export const LocalLogo: React.FC<LocalLogoProps> = ({ size = 28, className = '' }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 ${className}`}
    >
      <rect width="256" height="256" rx="60" fill="var(--bg-elevated)" />
      <rect
        x="10"
        y="10"
        width="236"
        height="236"
        rx="52"
        stroke="var(--border-strong)"
        strokeWidth="6"
      />
      <path
        d="M128 48C83.8172 48 48 83.8172 48 128C48 172.183 83.8172 208 128 208C154.3 208 177.638 195.308 192.226 175.716"
        stroke="var(--accent)"
        strokeWidth="16"
        strokeLinecap="round"
      />
      <path
        d="M106 88V146C106 151.523 110.477 156 116 156H162"
        stroke="var(--text-primary)"
        strokeWidth="18"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="176" cy="96" r="15" fill="var(--accent)" />
    </svg>
  );
};
