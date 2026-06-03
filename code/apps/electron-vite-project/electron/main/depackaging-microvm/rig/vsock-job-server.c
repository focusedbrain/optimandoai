/* Build 2b — GUEST-side vsock job server (depackaging microVM).
 *
 * Bridges virtio-vsock to the worker WITHOUT changing the worker's IO contract
 * and WITHOUT making Node touch the socket (Node/libuv does not handle an
 * AF_VSOCK fd as stdio reliably). It accepts ONE vsock connection and PROXIES
 * it to `node worker-bundle.cjs` over ordinary PIPES — the exact stdin/stdout
 * setup proven in 2a. guestEntry still reads one JSON job from stdin and writes
 * one JobResult JSON to stdout; this process shuttles those bytes to/from the
 * socket. So the one-JSON-object-each-way contract is unchanged; only the
 * transport (pipes <-> socket) is added here.
 *
 * Protocol (request/response): the host sends the job then half-closes (SHUT_WR);
 * we forward that to node's stdin and close it (node sees EOF, runs, replies);
 * we stream node's stdout back to the socket until node exits. Fire-and-forget:
 * one job per VM; init powers off afterwards. NO network, NO shared filesystem.
 *
 * Build (static):  gcc -static -O2 -o vsock-job-server vsock-job-server.c
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <linux/vm_sockets.h>

static int copy_until_eof(int from, int to) {
  char buf[1 << 16];
  ssize_t n;
  while ((n = read(from, buf, sizeof(buf))) > 0) {
    ssize_t off = 0;
    while (off < n) {
      ssize_t w = write(to, buf + off, (size_t)(n - off));
      if (w <= 0) return -1;
      off += w;
    }
  }
  return (n < 0) ? -1 : 0;
}

int main(int argc, char **argv) {
  unsigned int port = (argc > 1) ? (unsigned int)atoi(argv[1]) : 5252u;
  const char *node   = (argc > 2) ? argv[2] : "/bin/node";
  const char *bundle = (argc > 3) ? argv[3] : "/opt/worker/worker-bundle.cjs";

  int s = socket(AF_VSOCK, SOCK_STREAM, 0);
  if (s < 0) { perror("socket"); return 1; }
  struct sockaddr_vm addr;
  memset(&addr, 0, sizeof(addr));
  addr.svm_family = AF_VSOCK;
  addr.svm_cid = VMADDR_CID_ANY;
  addr.svm_port = port;
  if (bind(s, (struct sockaddr *)&addr, sizeof(addr)) < 0) { perror("bind"); return 1; }
  if (listen(s, 1) < 0) { perror("listen"); return 1; }
  fprintf(stderr, "vsock-job-server: listening cid=ANY port=%u\n", port);

  int c = accept(s, NULL, NULL);
  if (c < 0) { perror("accept"); return 1; }
  close(s);

  int to_node[2], from_node[2];     /* parent->child stdin ; child->parent stdout */
  if (pipe(to_node) < 0 || pipe(from_node) < 0) { perror("pipe"); return 1; }

  pid_t pid = fork();
  if (pid < 0) { perror("fork"); return 1; }
  if (pid == 0) {
    /* child: node, with the pipes as stdin/stdout (normal pipes, not the socket) */
    dup2(to_node[0], 0);
    dup2(from_node[1], 1);
    close(to_node[0]); close(to_node[1]);
    close(from_node[0]); close(from_node[1]);
    close(c);
    execl(node, node, bundle, (char *)NULL);
    perror("execl node");
    _exit(127);
  }

  /* parent: proxy socket <-> node pipes. Request fully arrives (host SHUT_WR),
     then node replies; the two phases don't overlap (guestEntry waits for EOF). */
  close(to_node[0]);
  close(from_node[1]);
  copy_until_eof(c, to_node[1]);   /* socket -> node stdin (job) */
  close(to_node[1]);               /* signal stdin EOF to node */
  copy_until_eof(from_node[0], c); /* node stdout (result) -> socket */
  close(from_node[0]);
  shutdown(c, SHUT_WR);
  close(c);

  int status = 0;
  waitpid(pid, &status, 0);
  fprintf(stderr, "vsock-job-server: job done (node status=%d)\n", status);
  return 0;
}
