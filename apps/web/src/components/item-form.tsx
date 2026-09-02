import {
	Button,
	CheckboxInput,
	Icon,
	SegmentedControl,
	SegmentedControlItem,
	Slider,
	Stack,
	TextArea,
	TextInput,
} from "@astryxdesign/core";
import { generatePassword } from "@svrgn/vault-core";
import { type FormEvent, useState } from "react";
import type { VaultItem } from "#/lib/models";
import { generatePassphrase } from "#/lib/password-generator";

export function ItemForm({
	initial,
	onCancel,
	onSave,
}: {
	initial: VaultItem;
	onCancel: () => void;
	onSave: (item: VaultItem) => void;
}) {
	const [draft, setDraft] = useState(initial);
	const [generatorMode, setGeneratorMode] = useState("password");
	const [length, setLength] = useState(20);
	const [symbols, setSymbols] = useState(true);
	const [generatorOpen, setGeneratorOpen] = useState(
		initial.password.length === 0,
	);

	const update = <K extends keyof VaultItem>(key: K, value: VaultItem[K]) =>
		setDraft((current) => ({ ...current, [key]: value }));

	const generate = () => {
		const password =
			generatorMode === "password"
				? generatePassword({ length, symbols })
				: generatePassphrase(Math.max(3, Math.round(length / 4)));
		update("password", password);
	};

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (!draft.title.trim()) return;
		onSave({
			...draft,
			title: draft.title.trim(),
			updatedAt: new Date().toISOString(),
		});
	};

	return (
		<form className="item-form" onSubmit={submit}>
			<Stack gap={4}>
				<div className="form-section-heading">
					<div>
						<span className="eyebrow">LOGIN ITEM</span>
						<h2>
							{initial.title === "Untitled login" ? "New login" : "Edit login"}
						</h2>
					</div>
					<CheckboxInput
						label="Favourite"
						value={draft.favorite}
						onChange={(value) => update("favorite", value)}
					/>
				</div>

				<TextInput
					label="Title"
					value={draft.title === "Untitled login" ? "" : draft.title}
					onChange={(value) => update("title", value)}
					placeholder="e.g. GitHub"
					width="100%"
					hasAutoFocus
					isRequired
				/>
				<div className="two-column-fields">
					<TextInput
						label="Username or email"
						value={draft.username}
						onChange={(value) => update("username", value)}
						placeholder="name@example.com"
						width="100%"
					/>
					<TextInput
						label="Website"
						value={draft.website}
						onChange={(value) => update("website", value)}
						placeholder="https://example.com"
						width="100%"
					/>
				</div>

				<div className="form-password-row">
					<TextInput
						label="Password"
						value={draft.password}
						onChange={(value) => update("password", value)}
						width="100%"
					/>
					<Button
						label="Password generator"
						variant="secondary"
						icon={<Icon icon="wrench" />}
						onClick={() => setGeneratorOpen((value) => !value)}
					/>
				</div>

				{generatorOpen ? (
					<div className="generator-panel">
						<div className="generator-topline">
							<div>
								<strong>Secure generator</strong>
								<span>Generated locally with Web Crypto</span>
							</div>
							<SegmentedControl
								value={generatorMode}
								onChange={setGeneratorMode}
								label="Generator type"
								size="sm"
							>
								<SegmentedControlItem value="password" label="Password" />
								<SegmentedControlItem value="passphrase" label="Passphrase" />
							</SegmentedControl>
						</div>
						<Slider
							label={generatorMode === "password" ? "Length" : "Word count"}
							value={length}
							onChange={setLength}
							min={generatorMode === "password" ? 12 : 12}
							max={generatorMode === "password" ? 40 : 28}
							step={generatorMode === "password" ? 1 : 4}
							formatValue={(value) =>
								generatorMode === "password"
									? `${value} characters`
									: `${Math.round(value / 4)} words`
							}
							valueDisplay="text"
						/>
						<div className="generator-actions">
							{generatorMode === "password" ? (
								<CheckboxInput
									label="Include symbols"
									value={symbols}
									onChange={setSymbols}
								/>
							) : (
								<span className="generator-hint">
									Words are joined with hyphens.
								</span>
							)}
							<Button label="Generate" variant="primary" onClick={generate} />
						</div>
					</div>
				) : null}

				<TextArea
					label="Notes"
					value={draft.notes}
					onChange={(value) => update("notes", value)}
					placeholder="Recovery details, security questions, or context…"
					width="100%"
					rows={5}
				/>

				<div className="form-actions">
					<Button label="Cancel" variant="ghost" onClick={onCancel} />
					<Button
						label="Save login"
						variant="primary"
						type="submit"
						isDisabled={!draft.title.trim()}
					/>
				</div>
			</Stack>
		</form>
	);
}
