// SI units. Impulse-based sphere contacts, Coulomb sliding/rolling friction,
// and equal/opposite impulses projected back into the membrane's modal basis.
#include <math.h>
#include <stdint.h>
#include <stdlib.h>

#define P(i,t) ((t*)(uintptr_t)buffers[i])
#define RADIUS .15
static double clamp(double x,double lo,double hi){return fmin(hi,fmax(lo,x));}

// Precompute the 4×4 inverse-mass Gram matrix for each interpolation cell.
// This evaluates sum(phi² / modal mass) without looping over the modes per grain.
void prepare_surface(uint32_t *buffers,int grid,int count){
  float *fields=P(9,float);double *mass=P(7,double),*gram=P(25,double);
  for(int z=0;z<grid-1;z++)for(int x=0;x<grid-1;x++){
    int k=z*grid+x,corner[4]={k,k+1,k+grid,k+grid+1},out=0;
    for(int a=0;a<4;a++)for(int b=a;b<4;b++){
      double value=0;for(int m=0;m<count;m++)value+=(double)fields[corner[a]*count+m]*fields[corner[b]*count+m]/mass[m];
      gram[k*10+out++]=value;
    }
  }
}

static inline void sample_vertex(int k,int count,uint32_t epoch,uint32_t *stamp,float *values,double *impulses,int *active,int *used,const float *fields,const float *q,const float *v){
  if(stamp[k]==epoch)return;
  float h=0,sv=0;
  for(int m=0;m<count;m++){float shape=fields[k*count+m];h+=shape*q[m];sv+=shape*v[m];}
  values[k*2]=h;values[k*2+1]=sv;impulses[k]=0;stamp[k]=epoch;active[(*used)++]=k;
}

void step_grains(uint32_t *buffers,int n,int count,int grid,double dt,double gravity,double mu,double restitution,double rolling){
  double *p=P(0,double),*v=P(1,double),*spin=P(2,double),*radii=P(3,double),*mass=P(4,double);
  double *q=P(5,double),*mv=P(6,double),*modeMass=P(7,double),*reaction=P(8,double);
  float *fields=P(9,float),*values=P(22,float);
  uint32_t *stamp=P(21,uint32_t),*control=P(26,uint32_t);
  double *impulses=P(23,double),*gram=P(25,double);int *active=P(24,int),used=0;
  uint32_t epoch=++control[0];
  if(epoch==0){for(int k=0;k<grid*grid;k++)stamp[k]=0;epoch=control[0]=1;}
  const double invCell=(grid-1)/(2*RADIUS);
  double ceiling=0,invModeMass[64];float qm[64],vm[64];
  for(int m=0;m<count;m++){ceiling+=fabs(q[m]);reaction[m]=0;qm[m]=q[m];vm[m]=mv[m];invModeMass[m]=1/modeMass[m];}
  for(int i=0;i<n;i++){
    int k=i*3;double r=radii[i];
    p[k]+=v[k]*dt;p[k+1]+=v[k+1]*dt-.5*gravity*dt*dt;p[k+2]+=v[k+2]*dt;v[k+1]-=gravity*dt;
    double radial2=p[k]*p[k]+p[k+2]*p[k+2],limit=RADIUS-r;
    if(radial2>limit*limit){
      double radial=sqrt(radial2),nx=p[k]/radial,nz=p[k+2]/radial,out=v[k]*nx+v[k+2]*nz;
      p[k]=nx*limit;p[k+2]=nz*limit;
      if(out>0){v[k]-=(1+restitution)*out*nx;v[k+2]-=(1+restitution)*out*nz;}
    }
    if(p[k+1]-r>ceiling+.000001)continue;
    double u=clamp((p[k]+RADIUS)*invCell,0,grid-1.000001),vv=clamp((p[k+2]+RADIUS)*invCell,0,grid-1.000001);
    int ix=(int)u,iz=(int)vv,cell=iz*grid+ix,corner[4]={cell,cell+1,cell+grid,cell+grid+1};
    double a=u-ix,b=vv-iz,weight[4]={(1-a)*(1-b),a*(1-b),(1-a)*b,a*b};
    for(int c=0;c<4;c++)sample_vertex(corner[c],count,epoch,stamp,values,impulses,active,&used,fields,qm,vm);
    double h00=values[cell*2],h10=values[(cell+1)*2],h01=values[(cell+grid)*2],h11=values[(cell+grid+1)*2];
    double h=weight[0]*h00+weight[1]*h10+weight[2]*h01+weight[3]*h11;
    double sx=((h10-h00)*(1-b)+(h11-h01)*b)*invCell,sz=((h01-h00)*(1-a)+(h11-h10)*a)*invCell;
    double normal2=1+sx*sx+sz*sz,dy=p[k+1]-h;
    if(dy>=0&&dy*dy>r*r*normal2)continue;
    double invN=1/sqrt(normal2),nx=-sx*invN,ny=invN,nz=-sz*invN,gap=dy*ny-r;
    p[k]-=gap*nx;p[k+1]-=gap*ny;p[k+2]-=gap*nz;
    double sv=0;for(int c=0;c<4;c++)sv+=weight[c]*values[corner[c]*2+1];
    double rvx=v[k],rvy=v[k+1]-sv,rvz=v[k+2],vn=rvx*nx+rvy*ny+rvz*nz;
    if(vn>=0)continue;
    double inverseSurfaceMass=0;int gi=0;
    for(int c=0;c<4;c++)for(int d=c;d<4;d++)inverseSurfaceMass+=weight[c]*weight[d]*gram[cell*10+gi++]*(c==d?1:2);
    double e=vn < -gravity*dt*3?restitution:0,im=1/mass[i];
    double jn=-(1+e)*vn/(im+ny*ny*inverseSurfaceMass);
    double tx=rvx-vn*nx-r*(spin[k+1]*nz-spin[k+2]*ny);
    double ty=rvy-vn*ny-r*(spin[k+2]*nx-spin[k]*nz);
    double tz=rvz-vn*nz-r*(spin[k]*ny-spin[k+1]*nx);
    double slip=sqrt(tx*tx+ty*ty+tz*tz),jt=slip>1e-12?fmin(mu*jn,slip*mass[i]/3.5)/slip:0;
    double jx=jn*nx-jt*tx,jy=jn*ny-jt*ty,jz=jn*nz-jt*tz;
    v[k]+=jx*im;v[k+1]+=jy*im;v[k+2]+=jz*im;
    double angular=2.5/(mass[i]*r);
    spin[k]-=angular*(ny*jz-nz*jy);spin[k+1]-=angular*(nz*jx-nx*jz);spin[k+2]-=angular*(nx*jy-ny*jx);
    double wn=spin[k]*nx+spin[k+1]*ny+spin[k+2]*nz,wx=spin[k]-wn*nx,wy=spin[k+1]-wn*ny,wz=spin[k+2]-wn*nz;
    double speed=sqrt(wx*wx+wy*wy+wz*wz),roll=speed>0?fmin(1,rolling*jn*angular/speed):0;
    spin[k]-=wx*roll;spin[k+1]-=wy*roll;spin[k+2]-=wz*roll;
    // Bilinear deposit followed by modal projection is the transpose of the
    // surface interpolation: it preserves the same two-way contact coupling.
    for(int c=0;c<4;c++)impulses[corner[c]]-=jy*weight[c];
  }
  for(int i=0;i<used;i++){
    int vertex=active[i];double impulse=impulses[vertex];if(impulse==0)continue;
    for(int m=0;m<count;m++)reaction[m]+=impulse*fields[vertex*count+m]*invModeMass[m];
  }
  for(int m=0;m<count;m++)mv[m]+=reaction[m];
}

static inline void collide_pair(int i,int j,double *p,double *v,double *w,double *radii,double *inverseMass,double *angularMass,double mu,double e){
  int k=i*3,l=j*3;double ri=radii[i],rj=radii[j],r=ri+rj,dx=p[k]-p[l],dy=p[k+1]-p[l+1],dz=p[k+2]-p[l+2],d2=dx*dx+dy*dy+dz*dz;
  if(d2>=r*r||d2<1e-24)return;
  double d=sqrt(d2),nx=dx/d,ny=dy/d,nz=dz/d,mi=inverseMass[i],mj=inverseMass[j],im=mi+mj,correction=(r-d)/im;
  p[k]+=nx*correction*mi;p[k+1]+=ny*correction*mi;p[k+2]+=nz*correction*mi;
  p[l]-=nx*correction*mj;p[l+1]-=ny*correction*mj;p[l+2]-=nz*correction*mj;
  double vx=v[k]-v[l],vy=v[k+1]-v[l+1],vz=v[k+2]-v[l+2],vn=vx*nx+vy*ny+vz*nz;
  if(vn>=0)return;
  double jn=-(1+e)*vn/im,wx=ri*w[k]+rj*w[l],wy=ri*w[k+1]+rj*w[l+1],wz=ri*w[k+2]+rj*w[l+2];
  double tx=vx-vn*nx-(wy*nz-wz*ny),ty=vy-vn*ny-(wz*nx-wx*nz),tz=vz-vn*nz-(wx*ny-wy*nx);
  double slip=sqrt(tx*tx+ty*ty+tz*tz),jt=slip>1e-12?fmin(mu*jn,slip/(3.5*im))/slip:0;
  double jx=jn*nx-jt*tx,jy=jn*ny-jt*ty,jz=jn*nz-jt*tz;
  v[k]+=jx*mi;v[k+1]+=jy*mi;v[k+2]+=jz*mi;v[l]-=jx*mj;v[l+1]-=jy*mj;v[l+2]-=jz*mj;
  double ax=ny*jz-nz*jy,ay=nz*jx-nx*jz,az=nx*jy-ny*jx;
  w[k]-=angularMass[i]*ax;w[k+1]-=angularMass[i]*ay;w[k+2]-=angularMass[i]*az;
  w[l]-=angularMass[j]*ax;w[l+1]-=angularMass[j]*ay;w[l+2]-=angularMass[j]*az;
}

// A bounded direct grid has no hash collisions. Each column is sorted by height,
// so airborne grains do not generate pairs with sand resting beneath them.
void collide_grains(uint32_t *buffers,int n,double mu,double e){
  double *p=P(0,double),*v=P(1,double),*w=P(2,double),*radii=P(3,double),*masses=P(4,double);
  int *heads=P(16,int),*links=P(17,int),*occupied=P(20,int);
  uint32_t *stamp=P(29,uint32_t),*control=P(26,uint32_t);
  double *inverseMass=P(27,double),*angularMass=P(28,double),*buildY=P(30,double);
  double largest=0;for(int i=0;i<n;i++)largest=fmax(largest,radii[i]);
  const double cell=fmax(2*largest,2*RADIUS/1021),invCell=1/cell,reach=2*largest;
  const int width=(int)ceil(2*RADIUS*invCell)+3;
  uint32_t epoch=++control[1];if(epoch==0){for(int i=0;i<1024*1024;i++)stamp[i]=0;epoch=control[1]=1;}
  int used=0;
  for(int i=0;i<n;i++){
    int cx=(int)clamp(floor((p[i*3]+RADIUS)*invCell)+1,1,width-2),cz=(int)clamp(floor((p[i*3+2]+RADIUS)*invCell)+1,1,width-2),key=cz*width+cx;
    double y=buildY[i]=p[i*3+1];inverseMass[i]=1/masses[i];angularMass[i]=2.5*inverseMass[i]/radii[i];
    if(stamp[key]!=epoch){stamp[key]=epoch;occupied[used++]=key;heads[key]=i;links[i]=-1;}
    else if(y<buildY[heads[key]]){links[i]=heads[key];heads[key]=i;}
    else{int j=heads[key];while(links[j]!=-1&&buildY[links[j]]<y)j=links[j];links[i]=links[j];links[j]=i;}
  }
  const int offset[4]={1,width-1,width,width+1};
  for(int c=0;c<used;c++){
    int key=occupied[c];
    for(int i=heads[key];i!=-1;i=links[i])for(int j=links[i];j!=-1;j=links[j]){
      if(buildY[j]-buildY[i]>reach)break;
      collide_pair(i,j,p,v,w,radii,inverseMass,angularMass,mu,e);
    }
    for(int o=0;o<4;o++){
      int other=key+offset[o];if(stamp[other]!=epoch)continue;
      int start=heads[other];
      for(int i=heads[key];i!=-1;i=links[i]){
        double low=buildY[i]-reach,high=buildY[i]+reach;
        while(start!=-1&&buildY[start]<low)start=links[start];
        for(int j=start;j!=-1;j=links[j]){
          if(buildY[j]>high)break;
          collide_pair(i,j,p,v,w,radii,inverseMass,angularMass,mu,e);
        }
      }
    }
  }
}

void update_height(uint32_t *buffers,float *height,int cells,int count){
  double *q=P(5,double);float *fields=P(9,float),mode[64];
  for(int m=0;m<count;m++)mode[m]=q[m];
  for(int k=0;k<cells;k++){
    float h=0;for(int m=0;m<count;m++)h+=fields[k*count+m]*mode[m];
    height[k]=.21f+h*20;
  }
}
