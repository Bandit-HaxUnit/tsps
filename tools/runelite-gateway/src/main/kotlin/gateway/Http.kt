package gateway
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.nio.file.*
fun http(port:Int,config:Path) {
 require(port !in listOf(43594,3000,49700));val h=HttpServer.create(InetSocketAddress("127.0.0.1",port),0)
 val raw=Files.readString(config,Charsets.ISO_8859_1).lines().map { line ->
  when {
   line.startsWith("codebase=")->"codebase=http://127.0.0.1:$port/"
   line.startsWith("param=12=")->"param=12=301"
   line.startsWith("param=25=")->"param=25=241"
   line.startsWith("param=17=")->"param=17=http://127.0.0.1:$port/slr.ws"
   line.startsWith("param=13=")->"param=13=127.0.0.1"
   line.startsWith("param=") && line.contains("https://")->line.substringBeforeLast('=')+"=http://127.0.0.1:$port/"
   else->line
  }
 }.joinToString("\n").toByteArray()
 h.createContext("/jav_config.ws"){x->x.sendResponseHeaders(200,raw.size.toLong());x.responseBody.use{it.write(raw)}}
 val worlds="""{"worlds":[{"id":301,"types":["MEMBERS"],"address":"127.0.0.1","activity":"TSPS local","location":0,"players":1}]}""".toByteArray()
 h.createContext("/worlds.js"){x->x.responseHeaders.add("Content-Type","application/json");x.sendResponseHeaders(200,worlds.size.toLong());x.responseBody.use{it.write(worlds)}}
 h.createContext("/slr.ws"){x-> val b=payload{writeInt(0);writeShort(1);writeShort(301);writeInt(1);text("127.0.0.1");text("TSPS local");writeByte(0);writeShort(1)};x.sendResponseHeaders(200,b.size.toLong());x.responseBody.use{it.write(b)}}
 h.start();Runtime.getRuntime().addShutdownHook(Thread{h.stop(0)})
 println("Gateway HTTP 127.0.0.1:$port")
}
