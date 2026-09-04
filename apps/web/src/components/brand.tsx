export function Brand({ compact = false }: { compact?: boolean }) {
	return (
		<div className="brand">
			<span className="brand-mark" aria-hidden="true">
				<svg viewBox="0 0 40 40" role="presentation">
					<path d="M20 4 33 9v9c0 8.4-5.3 14.7-13 18-7.7-3.3-13-9.6-13-18V9l13-5Z" />
					<path d="M14.5 19.5 18.2 23l7.8-8" />
				</svg>
			</span>
			{compact ? null : (
				<span className="brand-wordmark">
					<strong>Sovereignty</strong>
					<small>Vault</small>
				</span>
			)}
		</div>
	);
}
