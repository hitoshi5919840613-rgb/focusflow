self.__WB_DISABLE_DEV_LOGS = true;

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const notificationData = event.notification.data || {};
  const targetUrl = notificationData.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const matchingClient = clients.find((client) => {
        return typeof client.url === "string" && client.url.includes(targetUrl);
      });

      if (matchingClient) {
        return matchingClient.focus();
      }

      const firstClient = clients[0];
      if (firstClient && "navigate" in firstClient) {
        return firstClient.navigate(targetUrl).then(() => firstClient.focus());
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }

      return undefined;
    })
  );
});
