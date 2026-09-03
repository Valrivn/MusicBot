const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const orchestrator = require('../orchestrator');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ai')
        .setDescription('View and control the multi-model AI orchestrator')
        .addSubcommand(sub => sub
            .setName('status')
            .setDescription('Show model router, workers, and token budgets'))
        .addSubcommand(sub => sub
            .setName('dispatch')
            .setDescription('Dispatch a parallel multi-worker test task')
            .addIntegerOption(opt => opt
                .setName('workers')
                .setDescription('Number of parallel workers (1-10)')
                .setMinValue(1)
                .setMaxValue(10)
                .setRequired(false))),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'status') {
            await this.showStatus(interaction);
        } else if (subcommand === 'dispatch') {
            await this.dispatch(interaction);
        }
    },

    async showStatus(interaction) {
        await interaction.deferReply();

        try {
            const [models, limits, workerAwareness, metrics] = await Promise.all([
                orchestrator.getModels(),
                orchestrator.getTokenLimits(),
                orchestrator.getWorkerAwareness(),
                orchestrator.getMetrics()
            ]);

            const providerGroups = {};
            for (const model of models) {
                if (!providerGroups[model.provider]) providerGroups[model.provider] = [];
                providerGroups[model.provider].push(model);
            }

            const embed = new EmbedBuilder()
                .setTitle('🤖 Voxaria AI Orchestrator')
                .setColor('#39ff14')
                .setDescription(workerAwareness.enabled ? 'Parallel workers **enabled**' : 'Parallel workers **disabled**')
                .setTimestamp();

            for (const [provider, providerModels] of Object.entries(providerGroups)) {
                embed.addFields({
                    name: `${provider} (${providerModels.length} models)`,
                    value: providerModels.map(m => {
                        const healthIcon = m.health?.healthy ? '🟢' : '🔴';
                        const tokenNote = m.tokenLimit && m.tokenLimit <= 300 ? ' *(≤300 tok)*' : '';
                        return `${healthIcon} **${m.name}**${tokenNote} - ${m.maxTokens.toLocaleString()} max`;
                    }).join('\n'),
                    inline: true
                });
            }

            const claudeLimits = Object.entries(limits)
                .filter(([, v]) => v <= 300)
                .map(([k, v]) => `**${k}**: ${v} tokens`)
                .join('\n');
            embed.addFields({
                name: '🔒 Claude Token Limits',
                value: claudeLimits || 'No restrictive limits configured',
                inline: false
            });

            const workerStats = metrics.parallelCoordinator?.workers;
            embed.addFields({
                name: '⚙️ Worker Pool',
                value: `**Total:** ${workerStats?.total ?? 0}\n**Idle:** ${workerStats?.idle ?? 0}\n**Busy:** ${workerStats?.busy ?? 0}\n**Tasks Completed:** ${workerStats?.tasksCompleted ?? 0}`,
                inline: true
            });

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle('⚠️ Orchestrator Unavailable')
                    .setDescription(`Could not reach the orchestrator service. Ensure it's running on port 3001.\n\n\`${error.message}\``)
                    .setColor('#FF0000')]
            });
        }
    },

    async dispatch(interaction) {
        await interaction.deferReply();

        try {
            const count = Math.min(interaction.options.getInteger('workers') || 3, 10);
            const subtasks = Array.from({ length: count }, (_, i) => ({
                capability: i % 3 === 0 ? 'code' : i % 3 === 1 ? 'analysis' : 'text'
            }));

            const result = await orchestrator.dispatchParallel(subtasks);

            const embed = new EmbedBuilder()
                .setTitle('🚀 Parallel Task Dispatched')
                .setColor('#39ff14')
                .setDescription(`Task **${result.taskId.slice(0, 8)}** deployed across **${result.subtasks.length}** parallel workers.`)
                .setTimestamp();

            const assigneeLines = result.subtasks.map((st, i) => {
                const worker = st.workerId ? st.workerId.slice(0, 8) : `queued (pos ${st.position || '?'})`;
                return `• Sub-task ${i + 1}: \`${worker}\` **${st.status}**`;
            });
            embed.addFields({
                name: 'Worker Assignments',
                value: assigneeLines.join('\n'),
                inline: false
            });

            embed.addFields({
                name: '🔄 Worker Awareness',
                value: '```' + (result.awarenessPrompt || '').slice(0, 800) + '```',
                inline: false
            });

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle('⚠️ Dispatch Failed')
                    .setDescription(error.message)
                    .setColor('#FF0000')]
            });
        }
    }
};
