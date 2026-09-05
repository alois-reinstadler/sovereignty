import { Badge, Button, Card, EmptyState, Icon } from "@astryxdesign/core";
import { useState } from "react";
import { IS_DESKTOP } from "#/lib/client-platform";
import type { VaultItem } from "#/lib/models";

type ItemDetailProps = {
	item: VaultItem | null;
	isDisabled?: boolean;
	onBack: () => void;
	onCopy: (value: string, label: string) => void;
	onDelete: (item: VaultItem) => void;
	onEdit: (item: VaultItem) => void;
	onFavourite: (item: VaultItem) => Promise<void>;
};

export function ItemDetail({
	item,
	isDisabled = false,
	onBack,
	onCopy,
	onDelete,
	onEdit,
	onFavourite,
}: ItemDetailProps) {
	const [revealedItemId, setRevealedItemId] = useState<string | null>(null);
	const revealed = item !== null && revealedItemId === item.id;

	if (!item) {
		return (
			<div className="detail-empty">
				<EmptyState
					headingLevel={2}
					icon={<div className="empty-shield">S</div>}
					title="Choose a login"
					description="Select an item from your vault to view its details."
				/>
			</div>
		);
	}

	return (
		<article className="item-detail">
			<div className="detail-toolbar">
				<Button
					label="Back to vault"
					variant="ghost"
					isIconOnly
					icon={<Icon icon="chevronLeft" />}
					onClick={onBack}
					className="mobile-back"
				/>
				<div className="detail-actions">
					<Button
						label={
							item.favorite ? "Remove from favourites" : "Add to favourites"
						}
						variant="ghost"
						isIconOnly
						icon={<span aria-hidden="true">{item.favorite ? "★" : "☆"}</span>}
						onClick={async () => onFavourite(item)}
						isDisabled={isDisabled}
					/>
					<Button
						label="Edit"
						variant="secondary"
						onClick={() => onEdit(item)}
						isDisabled={isDisabled}
					/>
					<Button
						label="Delete"
						variant="ghost"
						onClick={() => onDelete(item)}
						isDisabled={isDisabled}
					/>
				</div>
			</div>

			<header className="detail-header">
				<div className="site-icon large">
					{item.title.slice(0, 1).toUpperCase()}
				</div>
				<div>
					<div className="detail-title-line">
						<h1>{item.title}</h1>
						{item.favorite ? (
							<Badge variant="yellow" label="Favourite" />
						) : null}
					</div>
					<p>{item.website || "Login"}</p>
				</div>
			</header>

			<div className="detail-content">
				<Card className="fields-card" padding={0}>
					<SecretRow
						label="Username"
						value={item.username || "Not set"}
						onCopy={
							item.username
								? () => onCopy(item.username, "Username")
								: undefined
						}
					/>
					<SecretRow
						label="Password"
						value={
							item.password
								? revealed
									? item.password
									: "••••••••••••••••"
								: "Not set"
						}
						monospace
						onCopy={
							item.password
								? () => onCopy(item.password, "Password")
								: undefined
						}
						end={
							item.password ? (
								<Button
									label={revealed ? "Hide password" : "Reveal password"}
									variant="ghost"
									isIconOnly
									icon={<Icon icon={revealed ? "eyeSlash" : "info"} />}
									onClick={() =>
										setRevealedItemId((current) =>
											current === item.id ? null : item.id,
										)
									}
								/>
							) : null
						}
					/>
					<SecretRow
						label="Website"
						value={item.website || "Not set"}
						onCopy={
							item.website ? () => onCopy(item.website, "Website") : undefined
						}
						link={item.website}
					/>
				</Card>

				{item.notes ? (
					<section className="notes-section">
						<h2>Notes</h2>
						<p>{item.notes}</p>
					</section>
				) : null}

				<p className="item-meta">
					Updated{" "}
					{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(
						new Date(item.updatedAt),
					)}
				</p>
			</div>
		</article>
	);
}

function SecretRow({
	label,
	value,
	monospace,
	onCopy,
	end,
	link,
}: {
	label: string;
	value: string;
	monospace?: boolean;
	onCopy?: () => void;
	end?: React.ReactNode;
	link?: string;
}) {
	return (
		<div className="secret-row">
			<div>
				<span>{label}</span>
				{link && !IS_DESKTOP ? (
					<a
						href={link.startsWith("http") ? link : `https://${link}`}
						target="_blank"
						rel="noreferrer"
					>
						{value} <Icon icon="externalLink" size="xsm" />
					</a>
				) : (
					<strong className={monospace ? "monospace" : undefined}>
						{value}
					</strong>
				)}
			</div>
			<div className="row-actions">
				{end}
				{onCopy ? (
					<Button
						label={`Copy ${label.toLowerCase()}`}
						variant="ghost"
						isIconOnly
						icon={<Icon icon="copy" />}
						onClick={onCopy}
					/>
				) : null}
			</div>
		</div>
	);
}
