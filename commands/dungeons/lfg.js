const {
    ActionRowBuilder,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ButtonBuilder,
} = require("discord.js");

const { dungeonList } = require("../../utils/loadJson");
const { getMainObject } = require("../../utils/getMainObject");
const { stripListedAsNumbers, isDPSRole } = require("../../utils/utilFunctions");
const { getEligibleComposition } = require("../../utils/dungeonLogic");
const { sendEmbed } = require("../../utils/sendEmbed");
const { interactionStatusTable } = require("../../utils/loadDb");
const { processError, createStatusEmbed } = require("../../utils/errorHandling");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("lfg")
        .setDescription("Pone un mensaje para encontrar a gente para la dungeon")
        .addStringOption((option) =>
            option
                .setName("dungeon")
                .setDescription("Selección la dungeon a hacer")
                .setRequired(true)
                .addChoices(...dungeonList.map((dungeon) => ({ name: dungeon, value: dungeon })))
        )
        .addStringOption((option) =>
            option
                .setName("listed_as")
                .setDescription("Nombre de tu grupo en el buscador de dungeons del WOW.")
                .setRequired(false)
        )
        .addStringOption((option) =>
            option
                .setName("creator_notes")
                .setDescription("Añade información sobre tu grupo")
                .setRequired(false)
        ),
    async execute(interaction) {
        const mainObject = getMainObject(interaction);

        const dungeonToRun = interaction.options.getString("dungeon");
        mainObject.embedData.dungeonName = dungeonToRun;

        // Set the listed as group name/creator notes if the user specified one
        const listedAs = interaction.options.getString("listed_as");
        if (listedAs) {
            const tempListedAs = stripListedAsNumbers(listedAs);
            if (tempListedAs) {
                mainObject.embedData.listedAs = tempListedAs;
            }
        }
        const creatorNotes = interaction.options.getString("creator_notes");
        if (creatorNotes) {
            mainObject.embedData.creatorNotes = creatorNotes;
        }

        // Timeout for the interaction collector
        const timeout = 90_000;

        // Parse key levels from the channel name
        const currentChannel = interaction.channel;
        const channelName = currentChannel.name;
        const channelNameSplit = channelName.split("-");
        const isSingularKeyLevel = channelNameSplit.length === 2;

        const lowerDifficultyRange = parseInt(channelNameSplit[1].replace("m", ""));

        let upperDifficultyRange;
        if (isSingularKeyLevel) {
            upperDifficultyRange = lowerDifficultyRange;
        } else {
            upperDifficultyRange = parseInt(channelNameSplit[2].replace("m", ""));
        }

        const difficultyPrefix = lowerDifficultyRange === 0 ? "M" : "+";

        // Make a list with dungeon difficulty ranges like +2, +3, +4
        const dungeonDifficultyRanges = [];

        for (let i = lowerDifficultyRange; i <= upperDifficultyRange; i++) {
            dungeonDifficultyRanges.push(i);
        }

        function getSelectDifficultyRow(difficultyPlaceholder) {
            const getSelectDifficulty = new StringSelectMenuBuilder()
                .setCustomId("difficulty")
                .setPlaceholder(difficultyPlaceholder)
                .setMinValues(1)
                .setMaxValues(1)
                .addOptions(
                    dungeonDifficultyRanges.map((range) =>
                        new StringSelectMenuOptionBuilder().setLabel(`${difficultyPrefix}${range}`).setValue(`${range}`)
                    )
                );

            const difficultyRow = new ActionRowBuilder().addComponents(getSelectDifficulty);
            return difficultyRow;
        }

        function getTimeCompletionRow(timeCompletionPlaceholder) {
            const getTimeCompletion = new StringSelectMenuBuilder()
                .setCustomId("timeCompletion")
                .setPlaceholder(timeCompletionPlaceholder)
                .setMinValues(1)
                .setMaxValues(1)
                .addOptions(
                    new StringSelectMenuOptionBuilder().setLabel("Timear").setValue("Timear"),
                    new StringSelectMenuOptionBuilder().setLabel("Completar").setValue("Completar")
                );

            const timeCompletionRow = new ActionRowBuilder().addComponents(getTimeCompletion);
            return timeCompletionRow;
        }

        function getSelectUserRoleRow(userRolePlaceholder) {
            const getSelectUserRow = new StringSelectMenuBuilder()
                .setCustomId("userRole")
                .setPlaceholder(userRolePlaceholder)
                .setMinValues(1)
                .setMaxValues(1)
                .addOptions(
                    new StringSelectMenuOptionBuilder()
                        .setLabel("Tank")
                        .setValue("Tank")
                        .setEmoji(mainObject.roles.Tank.emoji),
                    new StringSelectMenuOptionBuilder()
                        .setLabel("Healer")
                        .setValue("Healer")
                        .setEmoji(mainObject.roles.Healer.emoji),
                    new StringSelectMenuOptionBuilder()
                        .setLabel("DPS")
                        .setValue("DPS")
                        .setEmoji(mainObject.roles.DPS.emoji)
                );

            const userRoleRow = new ActionRowBuilder().addComponents(getSelectUserRow);
            return userRoleRow;
        }

        function getEligibleCompositionRow() {
            const eligibleComposition = getEligibleComposition(mainObject);

            const eligibleCompositionRow = new ActionRowBuilder().addComponents(eligibleComposition);
            return eligibleCompositionRow;
        }

        function getConfirmCancelRow() {
            const confirmSuccess = new ButtonBuilder().setLabel("Crear Grupo").setCustomId("confirm").setStyle(3);
            const confirmCancel = new ButtonBuilder().setLabel("Cancelar").setCustomId("cancel").setStyle(4);

            const confirmCancelRow = new ActionRowBuilder().addComponents(confirmSuccess, confirmCancel);
            return confirmCancelRow;
        }

        function getRows(
            difficultyPlaceholder,
            timeCompletionPlaceholder,
            selectUserPlaceholder,
            teamCompositionPlaceholder
        ) {
            const difficultyRow = getSelectDifficultyRow(difficultyPlaceholder);
            const timeCompletionRow = getTimeCompletionRow(timeCompletionPlaceholder);
            const userRoleRow = getSelectUserRoleRow(selectUserPlaceholder);
            const eligibleCompositionRow = getEligibleCompositionRow(teamCompositionPlaceholder);
            const confirmCancelRow = getConfirmCancelRow();

            return [difficultyRow, timeCompletionRow, userRoleRow, eligibleCompositionRow, confirmCancelRow];
        }

        // Temporary storage for dropdown values
        let dungeonDifficultyPlaceholder = "Selecciona nivel";
        let timeOrCompletionPlaceholder = "Timear o Completarla?";
        let userChosenRolePlaceholder = "Selecciona tu rol";
        let dungeonCompositionPlaceholder = "Selecciona la composición del grupo";

        async function updateRows(
            i,
            msgContent,
            dungeonDifficulty,
            timeOrCompletion,
            userChosenRole,
            dungeonComposition
        ) {
            const [difficultyRow, timeCompletionRow, userRoleRow, eligibleCompositionRow, confirmCancelRow] = getRows(
                dungeonDifficulty || dungeonDifficultyPlaceholder,
                timeOrCompletion || timeOrCompletionPlaceholder,
                userChosenRole || userChosenRolePlaceholder,
                dungeonComposition || dungeonCompositionPlaceholder
            );

            await i.update({
                content: msgContent,
                ephemeral: true,
                components: [difficultyRow, timeCompletionRow, userRoleRow, eligibleCompositionRow, confirmCancelRow],
            });
        }

        const userFilter = (i) => i.user.id === interaction.user.id;

        try {
            const [difficultyRow, timeCompletionRow, userRoleRow, eligibleCompositionRow, confirmCancelRow] = getRows(
                dungeonDifficultyPlaceholder,
                timeOrCompletionPlaceholder,
                userChosenRolePlaceholder,
                dungeonCompositionPlaceholder
            );

            let messageContent = `Estas creando un grupo para ${dungeonToRun}.`;
            const dungeonResponse = await interaction.reply({
                content: messageContent,
                ephemeral: true,
                components: [difficultyRow, timeCompletionRow, userRoleRow, eligibleCompositionRow, confirmCancelRow],
            });

            // Temporary storage for dungeon/group values
            let dungeonDifficulty = null;
            let timeOrCompletion = null;
            let userChosenRole = null;
            let dungeonComposition = null;
            let dungeonCompositionList = null;

            // Create a collector for both the drop-down menu and button interactions
            const dungeonCollector = dungeonResponse.createMessageComponentCollector({
                filter: userFilter,
                time: timeout,
            });

            dungeonCollector.on("collect", async (i) => {
                if (i.customId === "difficulty") {
                    dungeonDifficulty = `${difficultyPrefix}${i.values[0]}`;
                    mainObject.embedData.dungeonDifficulty = dungeonDifficulty;

                    await i.deferUpdate();
                } else if (i.customId === "timeCompletion") {
                    timeOrCompletion = i.values[0];
                    mainObject.embedData.timeOrCompletion = timeOrCompletion;

                    await i.deferUpdate();
                } else if (i.customId === "userRole") {
                    // Need to reset the composition list if the user changes their role to avoid
                    // the incorrect composition being sent to the embed
                    if (userChosenRole !== i.values[0]) {
                        dungeonCompositionList = null;
                        dungeonComposition = null;
                    }

                    // Add the user's chosen role to the main object so it's easily accessible
                    userChosenRole = i.values[0];
                    mainObject.interactionUser.userChosenRole = userChosenRole;

                    // Update the required composition drop-down based on the user's chosen role
                    await updateRows(
                        i,
                        messageContent,
                        dungeonDifficulty,
                        timeOrCompletion,
                        userChosenRole,
                        dungeonComposition
                    );
                } else if (i.customId === "composition") {
                    await i.deferUpdate();

                    // Return if the user tries to create a group without selecting their own role
                    if (i.values[0] === "none") {
                        return;
                    }
                    dungeonCompositionList = i.values;
                    dungeonComposition = dungeonCompositionList.join(", ");
                }
                // This is required if user selects the wrong options
                else if (i.customId === "confirm") {
                    // Notify the user if they haven't selected all the required options
                    // With a unique message for each missing option in order of priority
                    let messageContentMissing = messageContent;
                    if (!dungeonDifficulty) {
                        messageContentMissing += "\n**Selecciona nivel.**";
                    } else if (!timeOrCompletion) {
                        messageContentMissing += "\n**Timear o Completarla?**";
                    } else if (!userChosenRole) {
                        messageContentMissing += "\n**Selecciona tu rol.**";
                    } else if (!dungeonComposition) {
                        messageContentMissing += "\n**Selecciona tu roles requeridos.**";
                    }

                    if (!dungeonDifficulty || !timeOrCompletion || !userChosenRole || !dungeonComposition) {
                        await updateRows(
                            i,
                            messageContentMissing,
                            dungeonDifficulty,
                            timeOrCompletion,
                            userChosenRole,
                            dungeonComposition
                        );
                    } else {
                        // Add the user to the main object
                        mainObject.roles[userChosenRole].spots.push(mainObject.interactionUser.userId);
                        mainObject.roles[userChosenRole].nicknames.push(mainObject.interactionUser.nickname + " 🚩");

                        // Pull the filled spot from the main object
                        const filledSpot = mainObject.embedData.filledSpot;
                        let filledSpotCounter = 0;

                        for (const role in mainObject.roles) {
                            if (!dungeonCompositionList.includes(role)) {
                                const filledSpotCombined = `${filledSpot}${filledSpotCounter}`;
                                // Add filled members to the spots, except for the user's chosen role
                                if (role !== userChosenRole) {
                                    if (isDPSRole(role)) {
                                        if (mainObject.roles["DPS"].spots.length < 3) {
                                            mainObject.roles["DPS"].spots.push(filledSpotCombined);
                                            mainObject.roles["DPS"].nicknames.push(filledSpot);
                                        }
                                    } else {
                                        mainObject.roles[role].spots.push(filledSpotCombined);
                                        mainObject.roles[role].nicknames.push(filledSpot);
                                    }
                                }

                                if (isDPSRole(role) & (mainObject.roles["DPS"].spots.length >= 3)) {
                                    mainObject.roles["DPS"].disabled = true;
                                } else if (!isDPSRole(role)) {
                                    mainObject.roles[role].disabled = true;
                                }
                                filledSpotCounter++;
                            }
                        }

                        // Update the filled spot counter in the main object
                        mainObject.embedData.filledSpotCounter = filledSpotCounter;

                        const updatedDungeonCompositionList = dungeonCompositionList.map((role) => {
                            return role.startsWith("DPS") ? "DPS" : role;
                        });

                        await i.update({
                            content: `**Por favor asegurate que la gente que se apunta son __usuarios de Sin Presion__ y __usan la frase secreta__ en el juego!**\nLa frase secreta para la dungeon es: \`${mainObject.utils.passphrase.phrase}\``,
                            components: [],
                        });

                        await sendEmbed(mainObject, currentChannel, updatedDungeonCompositionList);

                        // Send the created dungeon status to the database
                        await interactionStatusTable.create({
                            interaction_id: interaction.id,
                            interaction_user: interaction.user.id,
                            interaction_status: "created",
                            command_used: "lfg",
                        });

                        dungeonCollector.stop("confirmCreation");
                    }
                } else if (i.customId === "cancel") {
                    dungeonCollector.stop("cancelled");
                }
            });

            dungeonCollector.on("end", async (collected, reason) => {
                if (reason === "time") {
                    await dungeonResponse.edit({
                        content: "Se acabo el tiemppo, usa /lfg para iniciar el grupo otra vez.",
                        components: [],
                    });

                    interactionStatusTable.create({
                        interaction_id: interaction.id,
                        interaction_user: interaction.user.id,
                        interaction_status: "timeoutBeforeCreation",
                        command_used: "lfg",
                    });
                } else if (reason === "cancelled") {
                    await createStatusEmbed("LFG cancelado.", dungeonResponse);

                    interactionStatusTable.create({
                        interaction_id: interaction.id,
                        interaction_user: interaction.user.id,
                        interaction_status: "cancelled",
                        command_used: "lfg",
                    });
                }
            });
        } catch (e) {
            processError(e, interaction);
        }
    },
};
