export const DEFAULT_MY_SERVER_PLUGIN = `module.exports = {

  name: "MyServer",


  register(api) {

    // Set combat and regular XP multipliers.
    api.setExperienceRates({
      combat: 6,
      regular: 18,
    });


    // Send a greeting when a player logs in.
    api.onPlayerLogin(({ player }) => {
      player.getPacketSender().sendMessage("Hello world!");
    });

  },

};
`;
