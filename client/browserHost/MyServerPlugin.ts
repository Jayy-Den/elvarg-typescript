export const DEFAULT_MY_SERVER_PLUGIN = `module.exports = {
  name: "MyServer",
  register(api) {
    api.onPlayerLogin(({ player }) => {
      player.getPacketSender().sendMessage("Hello world!");
    });
  },
};
`;
