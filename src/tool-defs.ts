// Claude Code に見せるツールの一覧。エディタ側の命令(src/lib/application/remote-control.ts)と1対1で対応する。
import type { ToolDef } from './mcp.ts';

const noArgs = { type: 'object', properties: {}, additionalProperties: false };

/** エディタへそのまま転送する命令。名前は remote-control.ts の命令名と同じ。 */
export const EDITOR_TOOLS: readonly ToolDef[] = [
	{
		name: 'get_state',
		description:
			'Get the editor state: open tabs, the active image\'s current edit parameters, history position, the list of parameters with their ranges (paramSpecs) and the presets. Units: exposure is in EV (-5..5); other params are normalized (-1..1, or 0..1 for sharpness/noiseReduction/grain). 0 is neutral. Params with rendered=false have no visible effect yet.',
		inputSchema: noArgs
	},
	{
		name: 'get_stats',
		description:
			'Get brightness statistics of the active image as currently shown (after edits): per-channel means, luma mean and percentiles (0..255), and the share of crushed shadows / blown highlights (0..1). The image pixels are never available; use these numbers to judge the photo.',
		inputSchema: noArgs
	},
	{
		name: 'set_params',
		description:
			'Set one or more edit parameters on the active image (unspecified params stay unchanged). Values outside the range are clamped. One call is one undo step. Returns the resulting params and a list of params that are not rendered yet.',
		inputSchema: {
			type: 'object',
			properties: {
				params: {
					type: 'object',
					description: 'Map of param key to number, e.g. {"exposure": 0.7, "temperature": 0.2}',
					additionalProperties: { type: 'number' }
				}
			},
			required: ['params'],
			additionalProperties: false
		}
	},
	{
		name: 'apply_preset',
		description:
			'Replace ALL params of the active image with a preset (natural, vivid, film, mono, sunset). One undo step. Use get_state to see the preset values.',
		inputSchema: {
			type: 'object',
			properties: { id: { type: 'string', enum: ['natural', 'vivid', 'film', 'mono', 'sunset'] } },
			required: ['id'],
			additionalProperties: false
		}
	},
	{ name: 'undo', description: 'Undo one history step on the active image.', inputSchema: noArgs },
	{ name: 'redo', description: 'Redo one history step on the active image.', inputSchema: noArgs },
	{ name: 'reset', description: 'Reset all params of the active image to neutral (one undo step).', inputSchema: noArgs },
	{
		name: 'select_tab',
		description: 'Make another open image (tab) the active one. Tab ids come from get_state.',
		inputSchema: {
			type: 'object',
			properties: { id: { type: 'string' } },
			required: ['id'],
			additionalProperties: false
		}
	}
];

export const CONNECTION_INFO_TOOL: ToolDef = {
	name: 'connection_info',
	description:
		'Show whether the editor is connected, and the one-time pairing code and port the user must type into the editor\'s "Claude Code と接続" panel. Call this first if other tools say the editor is not connected.',
	inputSchema: noArgs
};
